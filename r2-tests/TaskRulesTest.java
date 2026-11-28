package local.review;

import java.lang.reflect.Proxy;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

class TaskRulesTest {
  public static void main(String[] args) {
    List<Catalog.Item> items = new ArrayList<>();
    Catalog catalog = (Catalog) Proxy.newProxyInstance(Catalog.class.getClassLoader(),
        new Class<?>[]{Catalog.class}, (p, method, params) -> {
          if (method.getName().equals("items")) return items;
          throw new AssertionError("不可受理的批次开始读取文件");
        });
    var analysis = new AnalysisApi(null, catalog, null, null, null, null, null, "python", "", 9, "ReviewAnalysis");
    var owner = new CourseMapper.Course("default", "样本", "样本", "general");
    for (var statuses : List.of(List.<String>of(), List.of("failed"), List.of("ready","queued"),
        List.of("ready","running"), List.of("ready","recheck"))) {
      items.clear();
      for (String state : statuses)
        items.add(new Catalog.Item("f","样本.md","material",state,null,null));
      try {
        analysis.freeze(owner, UUID.randomUUID());
        throw new AssertionError(statuses);
      } catch (ResponseStatusException ex) {
        var expected = statuses.isEmpty() ? HttpStatus.NOT_FOUND : HttpStatus.CONFLICT;
        if (!expected.equals(ex.getStatusCode())) throw new AssertionError(ex);
      }
    }
    System.out.println("PASS R2-01 empty, failed and unfinished batches");
  }
}
