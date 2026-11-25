package local.review;

import java.util.*;

final class VideoRules {
  record Item(
      String url,
      String title,
      String target,
      List<String> topics,
      Long views,
      Long likes,
      Long favorites) {}

  record Report(String reason, List<Item> items) {}

  static List<String> priority(AnalysisApi.Result result) {
    var visible = new LinkedHashMap<String, String>();
    for (var r : result.ranked()) {
      if (result.paperCount() == 0 || r.count() > 0) visible.put(r.id(), r.topic().name());
    }
    var ordered = new LinkedHashSet<String>();
    if (result.plan() != null)
      for (var step : result.plan()) {
        if (visible.containsKey(step.topic())) ordered.add(visible.get(step.topic()));
      }
    ordered.addAll(visible.values());
    return List.copyOf(ordered);
  }

  static Report rank(List<Item> candidates, List<String> priority, String reason) {
    var unique = new LinkedHashMap<String, Item>();
    for (var item : candidates) {
      unique.merge(
          item.url(),
          item,
          (first, other) -> {
            var points = new LinkedHashSet<>(first.topics());
            points.addAll(other.topics());
            return new Item(
                first.url(),
                first.title(),
                first.target(),
                List.copyOf(points),
                first.views(),
                first.likes(),
                first.favorites());
          });
    }
    var items = new ArrayList<>(unique.values());
    if (items.isEmpty()) return new Report(reason.isEmpty() ? "暂无匹配视频" : reason, List.of());
    Comparator<Item> order = (a, b) -> 0;
    boolean comparable = false;
    for (java.util.function.Function<Item, Long> metric :
        List.<java.util.function.Function<Item, Long>>of(
            Item::views, Item::likes, Item::favorites)) {
      if (items.stream().allMatch(i -> metric.apply(i) != null)) {
        order = order.thenComparing(metric, Comparator.reverseOrder());
        comparable = true;
      }
    }
    if (!comparable) reason += " 热度无法比较，按参考计划排序。";
    items.sort(
        order.thenComparingInt(
            i -> i.topics().stream().mapToInt(priority::indexOf).min().orElse(Integer.MAX_VALUE)));
    return new Report(reason.strip(), items.stream().limit(3).toList());
  }
}
