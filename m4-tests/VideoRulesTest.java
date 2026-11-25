package local.review;

import static local.review.VideoRules.*;

import java.util.List;

public class VideoRulesTest {
  static Item sample(String url, String topic, Long views, Long likes, Long favorites) {
    return new Item(url, url, "独立视频", List.of(topic), views, likes, favorites);
  }

  static void check(boolean condition) {
    if (!condition) throw new AssertionError();
  }

  public static void main(String[] args) {
    var points = List.of("关系代数", "候选键");
    var a = sample("a", "候选键", 2L, 0L, 1L);
    var b = sample("b", "关系代数", 1L, 1L, 1L);
    var c = sample("c", "关系代数", 1L, 0L, 3L);
    var d = sample("d", "关系代数", 1L, 0L, 2L);
    var all = List.of(d, c, b, a);
    for (int i = 0; i <= 4; i++)
      check(rank(all.subList(0, i), points, "").items().size() == Math.min(i, 3));
    check(rank(all, points, "").items().equals(List.of(a, b, c)));
    var missing = sample("e", "关系代数", null, 3L, 0L);
    check(rank(List.of(a, missing), points, "").items().getFirst() == missing);
    var noMetrics = sample("f", "关系代数", null, null, null);
    var fallback = rank(List.of(a, noMetrics), points, "");
    check(fallback.items().getFirst() == noMetrics && fallback.reason().contains("热度无法比较"));
    var merged = rank(List.of(a, sample("a", "关系代数", 2L, 0L, 1L)), points, "");
    check(merged.items().size() == 1 && merged.items().getFirst().topics().size() == 2);
    System.out.println("M4-03/M4-04 ranking and deduplication passed");
  }
}
