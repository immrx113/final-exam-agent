package local.review;

import java.lang.reflect.Proxy;
import java.util.*;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.*;
import org.springframework.transaction.support.*;
import org.springframework.web.server.ResponseStatusException;

class CourseRulesTest {
  static void expectStatus(HttpStatus expected, Runnable action) {
    try {
      action.run();
      throw new AssertionError("Expected " + expected + " but succeeded");
    } catch (ResponseStatusException ex) {
      if (!expected.equals(ex.getStatusCode())) {
        throw new AssertionError("Expected " + expected + " but got " + ex.getStatusCode(), ex);
      }
    }
  }

  public static void main(String[] args) {
    Set<String> activeTasks = new HashSet<>();
    TaskMapper tasks = (TaskMapper) Proxy.newProxyInstance(TaskMapper.class.getClassLoader(),
        new Class<?>[]{TaskMapper.class}, (proxy, method, params) ->
          activeTasks.contains(params[0]) ? new TaskMapper.Task("t","j","k","pending",0,null,null,null) : null);
    Map<String, CourseMapper.Course> store = new LinkedHashMap<>();
    store.put(
        "default", new CourseMapper.Course("default", "数据库原理", "数据库原理", "database"));
    store.put("c-os", new CourseMapper.Course("c-os", "操作系统", "c-os", "general"));
    Set<String> activeItemCourses = new HashSet<>();
    List<String> steps = new ArrayList<>();

    CourseMapper mapper =
        (CourseMapper)
            Proxy.newProxyInstance(
                CourseMapper.class.getClassLoader(),
                new Class<?>[] {CourseMapper.class},
                (proxy, method, params) -> {
                  String m = method.getName();
                  return switch (m) {
                    case "find", "findForUpdate" -> store.get((String) params[0]);
                    case "summary" -> {
                      var row = store.get((String) params[0]);
                      yield row == null ? null : new CourseMapper.Summary(row.id(), row.name(), true);
                    }
                    case "list" ->
                        store.values().stream()
                            .map(r -> new CourseMapper.Summary(r.id(), r.name(), false))
                            .toList();
                    case "create" -> {
                      String id = (String) params[0];
                      String name = (String) params[1];
                      if (store.values().stream().anyMatch(c -> c.name().equals(name)))
                        throw new DuplicateKeyException("dup");
                      store.put(id, new CourseMapper.Course(id, name, id, "general"));
                      yield null;
                    }
                    case "rename" -> {
                      String id = (String) params[0];
                      String name = (String) params[1];
                      steps.add("rename:" + id + "->" + name);
                      if (store.values().stream()
                          .anyMatch(c -> !c.id().equals(id) && c.name().equals(name)))
                        throw new DuplicateKeyException("dup");
                      var old = store.get(id);
                      if (old == null) yield 0;
                      store.put(
                          id, new CourseMapper.Course(old.id(), name, old.topicNs(), old.profile()));
                      yield 1;
                    }
                    case "hasActiveItems" -> activeItemCourses.contains((String) params[0]);
                    case "versions" -> List.of("v-1", "v-2");
                    case "deleteStudyStates",
                        "deleteAnalysisHits",
                        "deleteAnalysisVersions",
                        "deleteSegments",
                        "deleteItems",
                        "deleteJobs",
                        "deleteFiles" -> {
                      steps.add(m + ":" + params[0]);
                      yield null;
                    }
                    case "deleteCourse" -> {
                      steps.add("deleteCourse:" + params[0]);
                      yield store.remove((String) params[0]) == null ? 0 : 1;
                    }
                    default -> throw new UnsupportedOperationException(m);
                  };
                });

    TransactionTemplate tx =
        new TransactionTemplate(
            new AbstractPlatformTransactionManager() {
              @Override
              protected Object doGetTransaction() {
                return new Object();
              }

              @Override
              protected void doBegin(Object transaction, TransactionDefinition definition) {}

              @Override
              protected void doCommit(DefaultTransactionStatus status) {}

              @Override
              protected void doRollback(DefaultTransactionStatus status) {}
            });

    CourseApi api = new CourseApi(mapper, tasks, tx, null);

    // Default course cannot be renamed or deleted
    expectStatus(
        HttpStatus.BAD_REQUEST, () -> api.rename("default", new CourseApi.NewCourse("新数据库")));
    expectStatus(HttpStatus.BAD_REQUEST, () -> api.delete("default"));

    // Non-existent course returns 404
    expectStatus(
        HttpStatus.NOT_FOUND, () -> api.rename("missing", new CourseApi.NewCourse("计算机网络")));
    expectStatus(HttpStatus.NOT_FOUND, () -> api.delete("missing"));

    // Name validation boundaries
    expectStatus(HttpStatus.BAD_REQUEST, () -> api.rename("c-os", null));
    for (String bad : List.of("", "   ", "含/斜杠", "含\\反斜杠", "含\n换行", "课".repeat(81))) {
      expectStatus(
          HttpStatus.BAD_REQUEST, () -> api.rename("c-os", new CourseApi.NewCourse(bad)));
    }
    expectStatus(
        HttpStatus.CONFLICT, () -> api.rename("c-os", new CourseApi.NewCourse(" 数据库原理 ")));

    // Unchanged trimmed name is a no-op
    steps.clear();
    var unchanged = api.rename("c-os", new CourseApi.NewCourse("  操作系统  "));
    if (!unchanged.name().equals("操作系统") || !steps.isEmpty()) {
      throw new AssertionError("Unchanged rename should not write to DB: " + steps);
    }

    // 80-codepoint boundary rename succeeds and preserves id
    String boundary80 = "精".repeat(80);
    var renamed = api.rename("c-os", new CourseApi.NewCourse(" " + boundary80 + " "));
    if (!renamed.id().equals("c-os") || !renamed.name().equals(boundary80) || !renamed.hasPublished()) {
      throw new AssertionError("Unexpected rename result: " + renamed);
    }

    // Active parsing item blocks course deletion with 409 without deleting any child table
    steps.clear();
    activeItemCourses.add("c-os");
    expectStatus(HttpStatus.CONFLICT, () -> api.delete("c-os"));
    if (!steps.isEmpty() || !store.containsKey("c-os")) {
      throw new AssertionError("Busy course must not be partially deleted: " + steps);
    }

    // Idle course deletes child tables in exact FK-safe order (null Redis template skipped safely or let's verify steps)
    activeItemCourses.clear();
    activeTasks.add("c-os");
    expectStatus(HttpStatus.CONFLICT, () -> api.delete("c-os"));
    activeTasks.clear();
    CourseApi apiNoCache =
        new CourseApi(
            mapper,
            tasks,
            tx,
            new org.springframework.data.redis.core.StringRedisTemplate() {
              @Override
              public Long delete(Collection<String> keys) {
                steps.add("evictCache:" + String.join(",", keys));
                return (long) keys.size();
              }
            });
    apiNoCache.delete("c-os");
    List<String> expectedOrder =
        List.of(
            "deleteStudyStates:c-os",
            "deleteAnalysisHits:c-os",
            "deleteAnalysisVersions:c-os",
            "deleteSegments:c-os",
            "deleteItems:c-os",
            "deleteJobs:c-os",
            "deleteFiles:c-os",
            "deleteCourse:c-os",
            "evictCache:review:m2:v-1,review:m2:v-2");
    if (!steps.equals(expectedOrder) || store.containsKey("c-os")) {
      throw new AssertionError("Unexpected delete sequence: " + steps);
    }

    System.out.println("PASS M6-09 CourseRulesTest (default lock, name bounds, busy guard, FK cascade & cache eviction)");
  }
}
