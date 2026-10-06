
import os
import glob

for test_file in glob.glob("tests/rules/*.test.js"):
    with open(test_file, "r", encoding="utf-8") as f:
        content = f.read()
    
    content = content.replace("await env.cleanup();", "if (env) await env.cleanup();")
    
    with open(test_file, "w", encoding="utf-8") as f:
        f.write(content)
