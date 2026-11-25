package local.review;

import java.util.List;
import static local.review.AnalysisApi.*;

class StudyRulesTest {
  static Ranked row(String name, int count) {
    return new Ranked(name, new Topic(name, "章节", name, List.of("讲义")), 0, count, count > 0 ? 1 : 0, List.of());
  }

  static void expect(List<StudyPlan.Step> steps, String... names) {
    if (!steps.stream().map(StudyPlan.Step::topic).toList().equals(List.of(names)))
      throw new AssertionError(steps);
  }

  public static void main(String[] args) {
    var rows = List.of(row("第三范式",4), row("候选键",2), row("函数依赖",1), row("主键",0));
    var first = new StudyPlan.Passage("第三范式前须先求候选键。","讲义-2");
    var second = new StudyPlan.Passage("先掌握函数依赖，再学习候选键。","讲义-3");
    var plan = StudyPlan.build(rows,1,List.of(first,second));
    expect(plan,"函数依赖","候选键","第三范式");
    if (!plan.get(0).ref().equals("讲义-3") || !plan.get(1).ref().equals("讲义-2"))
      throw new AssertionError("前置理由必须指向对应教学位置");
    expect(StudyPlan.build(rows,1,List.of()),"第三范式","候选键","函数依赖");
    expect(StudyPlan.build(rows,1,List.of(first,second,new StudyPlan.Passage("先学习第三范式，再学习函数依赖。","讲义-4"))),
        "第三范式","候选键","函数依赖");
    expect(StudyPlan.build(List.of(row("主键",0)),1,List.of()));
    expect(StudyPlan.build(List.of(row("主键",0)),0,List.of()),"主键");
    System.out.println("PASS M3-02,07 prerequisite chain, source links, fallback and visibility");
  }
}
