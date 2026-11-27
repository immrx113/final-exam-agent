package local.review;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.*;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping({"/api/course", "/api/courses/{course}"})
class AnalysisApi {
  private final CourseMapper courses;
  record Ref(String file, String name, String role, String label, String url, boolean review) {}

  record Input(String id, String role, String kind, List<ImportApi.Source> segments) {}

  record Topic(String name, String chapter, String text, List<String> refs) {}

  record Question(String file, String label, List<String> refs, List<String> matches) {}

  record Review(String reason, List<String> refs) {}

  record Output(String batch, List<Topic> topics, List<Question> questions, List<Review> reviews) {}

  record Ranked(
      String id, Topic topic, int outlineOrder, int count, int papers, List<Question> questions) {}

  record Result(
      String version,
      String job,
      int paperCount,
      List<Ranked> ranked,
      Map<String, Ref> sources,
      List<Review> reviews, List<StudyPlan.Step> plan) {}

  final Catalog catalog;
  final ImportApi imports;
  final AnalysisMapper db;
  final TransactionTemplate tx;
  final StringRedisTemplate cache;
  final ObjectMapper json;
  final String python, agent;
  final long timeout;
  private final Map<String, Integer> activeAnalyses = new HashMap<>();
  private final Set<String> deletingCourses = new HashSet<>();

  void enterAnalysis(String courseId) {
    synchronized (activeAnalyses) {
      if (deletingCourses.contains(courseId))
        throw new ResponseStatusException(HttpStatus.NOT_FOUND);
      activeAnalyses.merge(courseId, 1, Integer::sum);
    }
  }

  void exitAnalysis(String courseId) {
    synchronized (activeAnalyses) {
      activeAnalyses.computeIfPresent(courseId, (k, v) -> v > 1 ? v - 1 : null);
    }
  }

  void beginCourseDelete(String courseId) {
    synchronized (activeAnalyses) {
      if (activeAnalyses.containsKey(courseId) || deletingCourses.contains(courseId))
        throw new ResponseStatusException(HttpStatus.CONFLICT);
      deletingCourses.add(courseId);
    }
  }

  void endCourseDelete(String courseId) {
    synchronized (activeAnalyses) {
      deletingCourses.remove(courseId);
    }
  }

  AnalysisApi(CourseMapper courses,
      Catalog catalog,
      ImportApi imports,
      AnalysisMapper db,
      TransactionTemplate tx,
      StringRedisTemplate cache,
      ObjectMapper json,
      @Value("${review.python}") String python,
      @Value("${review.agent}") String agent,
      @Value("${review.agent-timeout-seconds}") long timeout) {
    this.courses = courses;
    this.catalog = catalog;
    this.imports = imports;
    this.db = db;
    this.tx = tx;
    this.cache = cache;
    this.json = json;
    this.python = python;
    this.agent = agent;
    this.timeout = timeout;
  }

  @GetMapping(value = "/analysis", produces = MediaType.APPLICATION_JSON_VALUE)
  String latest(@PathVariable(name="course", required=false) String course) {
    String version = db.latest(courses.require(course).id());
    if (version == null) return "null";
    String key = "review:m2:" + version;
    try {
      String cached = cache.opsForValue().get(key);
      if (cached != null) return cached;
    } catch (DataAccessException ignored) {
      /* MySQL holds the published snapshot. */
    }
    String result = db.result(version);
    try {
      cache.opsForValue().set(key, result, Duration.ofHours(1));
    } catch (DataAccessException ignored) {
      /* Retry on a later read. */
    }
    return result;
  }

  @PostMapping(value = "/jobs/{job}/analysis", headers = "X-Review-Request=1")
  synchronized Result analyze(@PathVariable(name="course", required=false) String course, @PathVariable UUID job) throws Exception {
    var owner = imports.ownedJob(course, job);
    enterAnalysis(owner.id());
    try {
      var items = catalog.items(job.toString());
      if (items.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
      if (items.stream().noneMatch(i -> i.status().equals("ready"))
          || items.stream().anyMatch(i -> !Set.of("ready", "failed").contains(i.status())))
        throw new ResponseStatusException(HttpStatus.CONFLICT);
      Map<String, Ref> refs = new LinkedHashMap<>();
      List<Input> files = new ArrayList<>();
      Set<String> papers = new HashSet<>();
      for (var item : items) {
        if (!item.status().equals("ready")) continue;
        var file = catalog.file(item.file());
        if (file.role().equals("exam") && !papers.add(file.digest())) continue;
        var sources = imports.segments(course, job, item.file());
        for (var s : sources)
          refs.put(
              s.id(), new Ref(file.id(), file.name(), file.role(), s.label(), s.url(), s.review()));
        files.add(new Input(file.id(), file.role(), Parser.kind(file.name()), sources));
      }
      String version = UUID.randomUUID().toString();
      Output output = runAgent(owner, files, version);
      validate(output, version, refs);
      var passages = files.stream().filter(f -> !f.role().equals("exam"))
          .flatMap(f -> f.segments().stream()).filter(s -> !s.review())
          .map(s -> new StudyPlan.Passage(s.body(), s.id())).toList();
      return tx.execute(status -> publish(owner, job.toString(), version, refs, output, passages));
    } finally {
      exitAnalysis(owner.id());
    }
  }

  private Output runAgent(CourseMapper.Course owner, List<Input> files, String batch) throws Exception {
    Path dir = Files.createTempDirectory("m2-batch-");
    Path input = dir.resolve("input.json"), output = dir.resolve("output.json");
    Process process = null;
    try {
      json.writeValue(input.toFile(), Map.of("batch", batch, "course", owner.name(), "profile", owner.profile(), "files", files));
      process =
          new ProcessBuilder(python, agent, input.toString(), output.toString())
              .redirectError(ProcessBuilder.Redirect.INHERIT)
              .redirectOutput(ProcessBuilder.Redirect.DISCARD)
              .start();
      if (!process.waitFor(timeout, TimeUnit.SECONDS))
        throw new ResponseStatusException(HttpStatus.GATEWAY_TIMEOUT);
      if (process.exitValue() != 0) throw new IOException("Agent failed");
      return json.readValue(output.toFile(), Output.class);
    } catch (IOException e) {
      throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "分析进程不可用", e);
    } finally {
      if (process != null && process.isAlive()) process.destroyForcibly().waitFor();
      Files.deleteIfExists(output);
      Files.deleteIfExists(input);
      Files.deleteIfExists(dir);
    }
  }

  private static void require(boolean ok) {
    if (!ok) throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "分析结果校验失败");
  }

  static void validate(Output out, String batch, Map<String, Ref> refs) {
    require(
        out != null
            && batch.equals(out.batch())
            && out.topics() != null
            && out.questions() != null
            && out.reviews() != null);
    Set<String> names = new HashSet<>(), labels = new HashSet<>(), matched = new HashSet<>();
    for (Topic t : out.topics()) {
      require(
          t.name() != null
              && !t.name().isBlank()
              && names.add(t.name())
              && t.chapter() != null
              && t.text() != null
              && t.refs() != null
              && (t.chapter().equals("待归类") || !t.refs().isEmpty()));
      for (String id : t.refs())
        require(
            refs.containsKey(id) && !refs.get(id).role().equals("exam") && !refs.get(id).review());
    }
    for (Question q : out.questions()) {
      require(
          q.label() != null
              && !q.label().isBlank()
              && labels.add(q.file() + "/" + q.label())
              && q.refs() != null
              && !q.refs().isEmpty()
              && q.matches() != null
              && names.containsAll(q.matches())
              && new HashSet<>(q.matches()).size() == q.matches().size());
      for (String id : q.refs())
        require(
            refs.containsKey(id)
                && refs.get(id).role().equals("exam")
                && refs.get(id).file().equals(q.file())
                && !refs.get(id).review());
      matched.addAll(q.matches());
    }
    for (Topic t : out.topics()) require(!t.refs().isEmpty() || matched.contains(t.name()));
    for (Review r : out.reviews())
      require(
          r.reason() != null
              && !r.reason().isBlank()
              && r.refs() != null
              && !r.refs().isEmpty()
              && refs.keySet().containsAll(r.refs()));
  }

  private static String topicId(String ns, String name) {
    return UUID.nameUUIDFromBytes((ns + "/" + name).getBytes(StandardCharsets.UTF_8)).toString();
  }

  private Result publish(CourseMapper.Course owner, String job, String version, Map<String, Ref> refs, Output out, List<StudyPlan.Passage> passages) {
    db.begin(owner.id(), version, job);
    Map<String, List<Question>> evidence = new HashMap<>();
    Set<String> papers = new HashSet<>();
    int number = 0;
    for (Question q : out.questions()) {
      papers.add(q.file());
      number++;
      for (String name : q.matches()) {
        db.hit(version, topicId(owner.topicNs(), name), q.file(), number);
        evidence.computeIfAbsent(name, unused -> new ArrayList<>()).add(q);
      }
    }
    Map<String, AnalysisMapper.Counts> counts = new HashMap<>();
    for (var c : db.counts(version)) counts.put(c.topic(), c);
    List<Ranked> ranked = new ArrayList<>();
    Map<String, Integer> chapters = new LinkedHashMap<>();
    for (Topic t : out.topics()) {
      chapters.putIfAbsent(t.chapter(), chapters.size());
      String id = topicId(owner.topicNs(), t.name());
      var c = counts.getOrDefault(id, new AnalysisMapper.Counts(id, 0, 0));
      ranked.add(
          new Ranked(
              id,
              t,
              ranked.size(),
              c.questions(),
              c.papers(),
              evidence.getOrDefault(t.name(), List.of())));
    }
    ranked.sort(
        Comparator.comparingInt(Ranked::count)
            .reversed()
            .thenComparing(Comparator.comparingInt(Ranked::papers).reversed())
            .thenComparingInt(r -> chapters.get(r.topic().chapter())));
    Result result = new Result(version, job, papers.size(), ranked, refs, out.reviews(), StudyPlan.build(ranked, papers.size(), passages));
    try {
      db.finish(version, json.writeValueAsString(result));
    } catch (IOException e) {
      throw new IllegalStateException(e);
    }
    return result;
  }
}
