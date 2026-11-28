package local.review;

import jakarta.annotation.PreDestroy;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.apache.rocketmq.client.consumer.DefaultMQPushConsumer;
import org.apache.rocketmq.client.consumer.listener.*;
import org.apache.rocketmq.client.producer.*;
import org.apache.rocketmq.common.consumer.ConsumeFromWhere;
import org.apache.rocketmq.common.message.Message;
import org.redisson.Redisson;
import org.redisson.api.*;
import org.redisson.config.Config;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

@Component
class AnalysisQueue {
  private static final Logger log = LoggerFactory.getLogger(AnalysisQueue.class);
  private final AnalysisApi analysis;
  private final TaskMapper tasks;
  private final String nameserver;
  private final RedissonClient redis;
  private DefaultMQProducer producer;
  private DefaultMQPushConsumer consumer;
  private final long lease;

  AnalysisQueue(AnalysisApi analysis, TaskMapper tasks,
      @Value("${review.rocketmq-address}") String nameserver,
      @Value("${spring.data.redis.host}") String host, @Value("${spring.data.redis.port}") int port) {
    this.analysis = analysis;
    this.tasks = tasks;
    this.nameserver = nameserver;
    lease = analysis.timeout + 30;
    Config config = new Config();
    config.setLazyInitialization(true);
    config.useSingleServer().setAddress("redis://" + host + ":" + port)
        .setTimeout(1000).setConnectTimeout(1000).setRetryAttempts(0)
        .setConnectionMinimumIdleSize(1).setConnectionPoolSize(4);
    redis = Redisson.create(config);
  }

  private void connect() throws Exception {
    if (producer == null) {
      var sender = new DefaultMQProducer("ReviewAnalysisOutbox");
      sender.setNamesrvAddr(nameserver);
      sender.setInstanceName(UUID.randomUUID().toString());
      sender.setVipChannelEnabled(false);
      sender.setRetryTimesWhenSendFailed(0);
      sender.start();
      producer = sender;
    }
    if (consumer != null) return;
    var worker = new DefaultMQPushConsumer(analysis.workerTopic + "Workers");
    worker.setNamesrvAddr(nameserver);
    worker.setInstanceName(UUID.randomUUID().toString());
    worker.setVipChannelEnabled(false);
    worker.setConsumeThreadMin(1);
    worker.setConsumeThreadMax(1);
    worker.setConsumeFromWhere(ConsumeFromWhere.CONSUME_FROM_FIRST_OFFSET);
    worker.subscribe(analysis.workerTopic, "*");
    worker.registerMessageListener((MessageListenerConcurrently) (messages, context) -> {
      try {
        for (var msg : messages) execute(new String(msg.getBody(), StandardCharsets.UTF_8));
        return ConsumeConcurrentlyStatus.CONSUME_SUCCESS;
      } catch (Exception e) {
        log.warn("Analysis delivery will be retried", e);
        return ConsumeConcurrentlyStatus.RECONSUME_LATER;
      }
    });
    worker.start();
    consumer = worker;
  }

  @Scheduled(fixedDelay=1500)
  void dispatch() {
    tasks.expire();
    try {
      connect();
    } catch (Exception e) {
      log.warn("Analysis queue connection pending: {}", e.toString());
      return;
    }
    for (var event : tasks.due()) {
      String id = event.id();
      try {
        var receipt = producer.send(new Message(event.topic(), null, id, id.getBytes(StandardCharsets.UTF_8)), 2000);
        if (receipt.getSendStatus() == SendStatus.SEND_OK) tasks.sent(id);
      } catch (Exception e) {
        tasks.waiting(id, "等待消息服务恢复");
      }
    }
  }

  private void execute(String id) throws Exception {
    var task = tasks.get(id);
    if (task == null || task.terminal()) return;
    RLock lock = redis.getLock("review:analysis:" + id);
    try {
      if (!lock.tryLock(0, lease, TimeUnit.SECONDS)) return;
    } catch (org.redisson.client.RedisException e) {
      tasks.waiting(id, "等待执行锁服务恢复");
      return;
    }
    String token = UUID.randomUUID().toString();
    try {
      if (tasks.claim(id, token, lease) == 0) return;
      String input = tasks.input(id, token);
      if (input == null) return;
      var frozen = analysis.json.readValue(input, AnalysisApi.Frozen.class);
      String version = UUID.randomUUID().toString();
      AnalysisApi.Prepared result;
      try {
        result = analysis.compute(frozen, task.job(), version);
      } catch (ResponseStatusException e) {
        boolean invalid = "分析结果校验失败".equals(e.getReason());
        int code = e.getStatusCode().value();
        var running = tasks.get(id);
        if (running != null)
          tasks.fail(id, token, invalid || running.attempts() >= 3 ? "failed" : "retry",
              invalid ? "分析结果含无效证据，请核对材料后重新分析" :
              code == 504 ? "分析超时，请重试" : "分析失败，请检查 Python 环境并重试", code);
        return;
      }
      if (!lock.isHeldByCurrentThread()) {
        tasks.lostLock(id, token);
        return;
      }
      analysis.tx.executeWithoutResult(status -> {
        if (tasks.finish(id, token, version) == 1)
          analysis.publish(frozen.owner(), task.job(), version, id, result);
      });
    } catch (org.redisson.client.RedisException e) {
      tasks.lostLock(id, token);
    } finally {
      try {
        if (lock.isHeldByCurrentThread()) lock.unlock();
      } catch (org.redisson.client.RedisException | IllegalMonitorStateException ignored) {
        // Lease expires independently of this consumer.
      }
    }
  }

  @PreDestroy
  void close() {
    if (consumer != null) consumer.shutdown();
    if (producer != null) producer.shutdown();
    redis.shutdown();
  }
}
