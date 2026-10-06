
import re

with open("tests/unit/pdf-util.test.js", "r", encoding="utf-8") as f:
    content = f.read()

replacement = """
    getContext: () => ({ drawImage: vi.fn() }),
    toDataURL: (_type, _quality) =>
      "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAAAAAAAAAAAAAAAAAAA/9k=",
    toBlob: (cb) => cb(new Blob(["mock-image-data"], { type: "image/jpeg" }))
  })),
}));"""

content = re.sub(r"getContext:\s*\(\)\s*=>\s*\(\{\s*drawImage:\s*vi\.fn\(\)\s*\}\),\s*toDataURL:\s*\(_type,\s*_quality\)\s*=>\s*\"data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAAAAAAAAAAAAAAAAAAA/9k=\",\s*\}\)\),\s*\}\)\);", replacement.strip(), content)

with open("tests/unit/pdf-util.test.js", "w", encoding="utf-8") as f:
    f.write(content)
