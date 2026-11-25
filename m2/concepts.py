"""Evidence rules for publishing concepts from database course materials."""
import re


# These names help recognize subjects in text. None is published without a source.
CORE = ("函数依赖", "候选键", "关系代数", "事务隔离", "数据库索引", "第三范式",
        "外键", "主键", "并发控制", "数据库恢复", "关系模式分解", "视图", "死锁")
SUBJECTS = CORE + tuple("""
数据模型 关系模型 网状模型 层次模型 概念模型 逻辑模型 物理模型 数据字典
数据库管理系统 三级模式 两级映像 数据独立性 逻辑独立性 物理独立性 外模式 内模式
实体型 实体集 联系集 一对一联系 一对多联系 多对多联系 关系模式 元组 超键 全码
实体完整性 参照完整性 用户定义完整性 唯一性约束 完整性约束 检查约束 断言 触发器
笛卡尔积 自然连接 等值连接 外连接 半连接 关系除法 集合运算 比较运算符
子查询 嵌套查询 相关子查询 分组查询 连接查询 聚集函数 聚合函数
数据定义语言 数据操纵语言 数据控制语言 基本表 唯一索引 聚簇索引
部分函数依赖 完全函数依赖 传递函数依赖 多值依赖 属性闭包 无损连接 模式分解
范式 第一范式 第二范式 第四范式 第五范式 BCNF ACID SQL 关系规范化
概念结构设计 逻辑结构设计 物理结构设计 数据流图 数据库完整性 数据库安全性
存取控制 自主存取控制 强制存取控制 审计 数据加密 明文 密文
事务 两阶段锁协议 可串行化调度 封锁协议 日志文件 检查点
""".split()) + ("GROUP BY 子句", "HAVING 子句", "ORDER BY 子句", "WHERE 子句",
                 "SELECT 子句", "FROM 子句", "SET 子句", "INTO 子句", "VALUES 子句",
                 "LIMIT 子句", "JOIN 子句", "ON 子句", "FOREIGN KEY 约束")
KNOWN = set(SUBJECTS)
CLAUSE_NAMES = {s.removesuffix(" 子句").replace(" ", ""): s for s in SUBJECTS if s.endswith(" 子句")}
SQL_CLAUSE = re.compile(r"(?<![A-Za-z0-9_])(" +
                        "|".join(re.escape(s.removesuffix(" 子句")).replace(r"\ ", r"\s*")
                                 for s in SUBJECTS if s.endswith(" 子句")) + r")\s*子句", re.I)


def normalize_clauses(text):
    return SQL_CLAUSE.sub(lambda m: CLAUSE_NAMES[re.sub(r"\s+", "", m[1]).upper()], text)
DEFINITION = re.compile(r"^([\w· -]{2,26}?)(\s*:\s*|是指|指的是|定义为|是一种|是一类)(.+)$")
DOMAIN_NOUN = re.compile(
    r"(?:依赖|范式|协议|算法|模型|约束|索引|结构|查询|运算|事务|调度|映射|映像|"
    r"完整性|独立性|一致性|隔离性|持久性|原子性|机制|闭包|系统|语言|子句|"
    r"连接|函数|关系|实体|联系|模式|属性|存储|加密|编码|分解|日志|控制|操作符)$")
NOISE = re.compile(
    r"^(?:主讲|目录|教学目标|课堂|请|例如|例题|习题|练习|小结|答案|方法[一二三]|"
    r"注意|结论|假设|所谓的|从|到|将|如何|没有|任何|创建|生成|写出|判断|列出|第[一二三四五六七八九十\d]|"
    r"以下|这里|这一|本题|本章|本节|示例|步骤|说明|简称|概念$|定义$|含义$|"
    r"组成$|方法$|原因$|结果$|输入$|输出$|特点$|举例$|过程$)")
SKIP_LINE = re.compile(r"@|《|》|https?://|^\s*(?:E-?mail|主讲|例题|例\s*\d|习题|练习|答案|课堂小问答|请思考)", re.I)
MARKER = re.compile(r"^(?:[。·•●○□■◼囗◆◇※]+\s*|\d+(?:\s*[.·]\s*\d+)+\s*(?=[^\d.·])|\(?\d+\s*[)．、.]\s*)+")
PROSE = re.compile(r"是|指的是|称为|用于|用来|表示|包括|包含|满足|通过|决定|允许|具有|保证|执行|标识|保留|建立在|要求.+|定义为")
FOLLOW = re.compile(r"^(?:是|指|可用于|可用来|用于|用来|由|能够|具有|用.+表示)")


def term_name(value):
    return value.strip(" \t·•●○□■囗◆◇")


def term_patterns(names):
    patterns = []
    for name in sorted(set(names), key=lambda s: (-len(s), s)):
        pattern = re.escape(name)
        if name[0].isascii() and name[0].isalnum():
            pattern = r"(?<![A-Za-z0-9_])" + pattern
        if name[-1].isascii() and name[-1].isalnum():
            pattern += r"(?![A-Za-z0-9_])"
        patterns.append(pattern)
    return re.compile("|".join(patterns))


def noun(name):
    if name in KNOWN:
        return True
    if name.endswith("子句") and re.search("[A-Za-z]", name):
        return False
    if NOISE.search(name) or not re.fullmatch(r"[\u4e00-\u9fffA-Za-z0-9-]{2,18}", name):
        return False
    return bool(re.search(r"[\u4e00-\u9fff]{2}", name) and DOMAIN_NOUN.search(name))


def explanatory(text):
    if SKIP_LINE.search(text):
        return False
    return len(re.findall(r"[\u4e00-\u9fff]", text)) >= 6 or len(re.findall(r"\b[A-Za-z]{2,}\b", text)) >= 4


def teaching_definition(line):
    """A colon introduces everything from a table field to a lecturer's name."""
    match = DEFINITION.match(line)
    if not match:
        return None
    name, cue, explanation = match.groups()
    name = term_name(name)
    explicit = cue.strip() != ":"
    unfamiliar = (explicit and re.fullmatch(r"[\u4e00-\u9fff]{2,8}", name)
                  and not NOISE.search(name) and not re.search(r"[的是不则与将]", name))
    if not (noun(name) or unfamiliar) or not explanatory(explanation):
        return None
    if name in KNOWN or cue.strip() != ":" or PROSE.search(explanation):
        return name, explanation.strip()
    return None


# Match the subject at a word boundary for Latin text. Prefer the specific term
# in “完全函数依赖”, without also creating the broader concept from that single mention.
SUBJECT = term_patterns(KNOWN)


def teaching_subject(line):
    for match in SUBJECT.finditer(line):
        name = match[0]
        prefix = line[:match.start()].strip(" ·:。")
        tail = line[match.end():].strip()
        if prefix in ("", "到") and (not tail or tail[0] in ":-(是指的为与" or PROSE.search(tail)):
            return name
    return None
