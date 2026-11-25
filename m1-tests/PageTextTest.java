package local.review;

public class PageTextTest {
  static void check(boolean condition, String scenario) {
    if (!condition) throw new AssertionError(scenario);
  }

  public static void main(String[] args) {
    check(PageText.suspect("- 2/30页 -《 示例课程 》"), "Footer-only slide");
    check(PageText.suspect("第 4 页"), "Page number");
    check(PageText.suspect("㐀㐁㐂㐃 㐄㐅㐆㐇 Ƚ 123"), "Broken CJK mapping");
    check(!PageText.suspect("SELECT name FROM student;"), "Native SQL");
    check(PageText.suspect("- 2/30页 -《 示例课程 》\nA\nB\nC\nD"), "Sparse diagram labels below footer");
    check(
        !PageText.suspect("数据库系统的关系模式与主键约束\n- 2/30页 -《 示例课程 》"), "Useful native text above footer");
    check(
        PageText.fromOcr("数 据 库 设 计\nSELECT DISTINCT id").equals("数据库设计\nSELECT DISTINCT id"),
        "Chinese and SQL spacing");
    System.out.println("PASS page quality checks");
  }
}
