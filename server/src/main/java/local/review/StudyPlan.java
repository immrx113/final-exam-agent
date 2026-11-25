package local.review;

import java.util.*;
import java.util.regex.*;
import java.util.stream.Collectors;
import static local.review.AnalysisApi.*;

final class StudyPlan {
  record Step(String topic, String reason, String ref) {}
  record Passage(String body, String ref) {}
  record Edge(String before, String after, String ref) {}

  static List<Step> build(List<Ranked> ranked, int papers, Iterable<Passage> passages) {
    var rows = ranked.stream().filter(r -> papers == 0 || r.count() > 0).toList();
    if (rows.isEmpty()) return List.of();
    var names = rows.stream().map(r -> r.topic().name()).sorted(Comparator.comparingInt(String::length).reversed())
        .map(Pattern::quote).collect(Collectors.joining("|", "(", ")"));
    Pattern forward = Pattern.compile("先(?:学习|理解|掌握|回顾|求出?|学)?" + names + "[，,、\\s]*(?:然后|再)(?:学习|理解|判断|掌握|学)?" + names);
    Pattern backward = Pattern.compile(names + "(?:前|之前|的前提是|依赖于|需要以)[，,：:\\s]*(?:必须|需要|应当|应|须)?(?:先)?(?:学习|理解|掌握|求出?|学)?" + names);
    Map<String, List<Edge>> prerequisites = new HashMap<>();
    for (var passage : passages) {
      for (Pattern rule : List.of(forward, backward)) {
        var matches = rule.matcher(passage.body());
        while (matches.find()) {
          String before = matches.group(rule == forward ? 1 : 2);
          String after = matches.group(rule == forward ? 2 : 1);
          if (!before.equals(after))
            prerequisites.computeIfAbsent(after, k -> new ArrayList<>()).add(new Edge(before, after, passage.ref()));
        }
      }
    }
    var byName = new HashMap<String, Ranked>();
    for (var row : rows) byName.put(row.topic().name(), row);
    var ordered = new LinkedHashMap<String, Step>();
    for (var row : rows) {
      if (!append(row, null, papers, prerequisites, byName, ordered, new HashSet<>()))
        return rows.stream().map(r -> step(r, papers, null)).toList();
    }
    return List.copyOf(ordered.values());
  }

  private static boolean append(Ranked row, Edge edge, int papers, Map<String,List<Edge>> prerequisites,
      Map<String,Ranked> byName, Map<String,Step> ordered, Set<String> visiting) {
    String name = row.topic().name();
    if (ordered.containsKey(name)) return true;
    if (!visiting.add(name)) return false;
    for (var required : prerequisites.getOrDefault(name, List.of()))
      if (!append(byName.get(required.before()), required, papers, prerequisites, byName, ordered, visiting)) return false;
    visiting.remove(name);
    ordered.put(name, step(row, papers, edge));
    return true;
  }

  private static Step step(Ranked row, int papers, Edge edge) {
    if (edge != null) return new Step(row.id(), "先掌握此项，为学习“" + edge.after() + "”做准备。", edge.ref());
    String reason = papers == 0 ? "暂无试卷统计，按课程章节顺序学习。" : "命中 " + row.count() + " 题，覆盖 " + row.papers() + "/" + papers + " 份卷，按真题频次安排。";
    return new Step(row.id(), reason, null);
  }
}
