package local.review;

import com.fasterxml.jackson.databind.*;
import java.io.IOException;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import org.springframework.web.util.HtmlUtils;

@Component
class VideoSource {
  private static final String COURSE = "数据库原理";
  private static final String API = "https://api.bilibili.com";
  private final ObjectMapper json;
  private final String base;
  private final JsonNode catalog;
  private final HttpClient http =
      HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

  VideoSource(ObjectMapper json, @Value("${review.video-api:https://api.bilibili.com}") String base)
      throws IOException {
    this.json = json;
    this.base = base;
    if (!API.equals(base) && !base.matches("http://127\\.0\\.0\\.1:[0-9]+"))
      throw new IllegalArgumentException("视频数据源须为公开接口或本机测试服务");
    try (var stream = new ClassPathResource("video-catalog.json").getInputStream()) {
      catalog = json.readTree(stream);
    }
  }

  private JsonNode get(String path) throws IOException, InterruptedException {
    var request =
        HttpRequest.newBuilder(URI.create(base + path))
            .timeout(Duration.ofSeconds(8))
            .GET()
            .build();
    var res = http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    if (res.statusCode() != 200) throw new IOException("HTTP " + res.statusCode());
    var body = json.readTree(res.body());
    if (body == null
        || !body.has("code")
        || body.path("code").asInt(-1) != 0
        || !body.path("data").isObject()) throw new IOException("接口未提供有效数据");
    return body.get("data");
  }

  static boolean validId(String id) {
    return id.matches("BV[A-Za-z0-9]{10}");
  }

  private static String title(JsonNode node) {
    return HtmlUtils.htmlUnescape(node.path("title").asText("").replaceAll("<[^>]+>", "")).strip();
  }

  private static Long count(JsonNode stats, String key) {
    var value = stats.path(key);
    return value.isIntegralNumber() && value.canConvertToLong() && value.longValue() >= 0
        ? value.longValue()
        : null;
  }

  private static List<String> matches(String title, List<String> topics) {
    String text = title.toLowerCase(Locale.ROOT);
    return topics.stream().filter(t -> text.contains(t.toLowerCase(Locale.ROOT))).toList();
  }

  private static VideoRules.Item item(
      String id, int page, String title, String target, List<String> points, JsonNode stats) {
    String url = "https://www.bilibili.com/video/" + id + "/" + (page > 0 ? "?p=" + page : "");
    return new VideoRules.Item(
        url,
        title,
        target,
        points,
        count(stats, "view"),
        count(stats, "like"),
        count(stats, "favorite"));
  }

  record Candidate(String name, Set<String> queries) {}

  static List<VideoRules.Item> resolve(
      String id, Candidate candidate, JsonNode detail, List<String> topics) {
    String name = title(detail);
    if (name.isBlank()) name = candidate.name();
    var items = new ArrayList<VideoRules.Item>();
    var stats = detail.path("stat");
    var pages = detail.path("pages");
    if (pages.size() > 1)
      for (var page : pages) {
        String part = page.path("part").asText();
        int number = page.path("page").asInt();
        var points = matches(part, topics);
        if (!points.isEmpty() && number > 0)
          items.add(item(id, number, name + " · " + part, "分 P", points, stats));
      }
    for (var section : detail.path("ugc_season").path("sections"))
      for (var episode : section.path("episodes")) {
        String episodeId = episode.path("bvid").asText();
        var points = matches(title(episode), topics);
        if (!points.isEmpty() && validId(episodeId))
          items.add(
              item(episodeId, 0, title(episode), "合集单集", points, episode.path("arc").path("stat")));
      }
    if (!items.isEmpty()) return items;
    var points = matches(name, topics);
    boolean courseTitle = name.contains(COURSE) || name.contains("数据库系统概论");
    if (points.isEmpty() && courseTitle && pages.size() == 0)
      points = List.copyOf(candidate.queries());
    if (!points.isEmpty())
      items.add(
          item(
              id,
              0,
              name,
              pages.size() > 1 || (pages.isEmpty() && courseTitle) ? "整套课程" : "独立视频",
              points,
              stats));
    return items;
  }

  VideoApi.State lookup(List<String> topics) throws InterruptedException {
    if (topics.isEmpty()) return new VideoApi.State("ready", "暂无可推荐的知识点", List.of());
    var candidates = new LinkedHashMap<String, Candidate>();
    var notices = new LinkedHashSet<String>();
    for (String topic : topics.stream().limit(3).toList()) {
      String q = URLEncoder.encode(COURSE + " " + topic, StandardCharsets.UTF_8);
      try {
        var data = get("/x/web-interface/search/type?search_type=video&keyword=" + q);
        if (!data.path("result").isArray() && data.path("numResults").asInt(-1) != 0)
          throw new IOException("接口未返回列表");
        int kept = 0;
        for (var hit : data.path("result")) {
          String id = hit.path("bvid").asText();
          if (!validId(id)) continue;
          candidates
              .computeIfAbsent(id, k -> new Candidate(title(hit), new LinkedHashSet<>()))
              .queries()
              .add(topic);
          if (++kept == 3) break;
        }
      } catch (IOException e) {
        notices.add("公开搜索未完成（" + failure(e) + "）。");
        break;
      }
    }
    var items = new ArrayList<VideoRules.Item>();
    for (var entry : candidates.entrySet()) {
      JsonNode detail = details(entry.getKey(), notices);
      items.addAll(resolve(entry.getKey(), entry.getValue(), detail, topics));
    }
    boolean usedCatalog = false;
    if (items.isEmpty()) {
      for (var entry : catalog.path(COURSE)) {
        String id = entry.asText();
        if (!validId(id) || candidates.containsKey(id)) continue;
        items.addAll(resolve(id, new Candidate("", Set.of()), details(id, notices), topics));
      }
      usedCatalog = !items.isEmpty();
    }
    boolean failed = !notices.isEmpty();
    if (usedCatalog) notices.add("推荐来自课程 BV 候选目录。");
    if (items.isEmpty() && !failed) notices.add("暂无匹配视频");
    var report = VideoRules.rank(items, topics, String.join(" ", notices));
    String status = failed ? (items.isEmpty() ? "failed" : "partial") : "ready";
    return new VideoApi.State(status, report.reason(), report.items());
  }

  private JsonNode details(String id, Set<String> notices) throws InterruptedException {
    try {
      return get("/x/web-interface/view?bvid=" + id);
    } catch (IOException e) {
      notices.add("视频详情读取未完成（" + failure(e) + "）。");
      return json.createObjectNode();
    }
  }

  private static String failure(IOException e) {
    if (e instanceof HttpTimeoutException) return "请求超时";
    String message = Objects.toString(e.getMessage(), "");
    return message.matches("HTTP [0-9]{3}") ? message : "网络或接口不可用";
  }
}
