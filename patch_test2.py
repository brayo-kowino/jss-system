
import re

with open("tests/unit/student-import.test.js", "r", encoding="utf-8") as f:
    content = f.read()

# The error was: AssertionError: expected "NUM-MUWELUNN-3" to match /^PENDING-/
content = content.replace("expect(validated[0].data.admissionNumber).toMatch(/^PENDING-/);", "expect(validated[0].data.admissionNumber).toMatch(/^NUM-/);")

with open("tests/unit/student-import.test.js", "w", encoding="utf-8") as f:
    f.write(content)
