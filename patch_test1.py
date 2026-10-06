
import re

with open("tests/unit/subscription-state.test.js", "r", encoding="utf-8") as f:
    content = f.read()

replacement = """
    expect(getSubscriptionState(null)).toEqual({
      active: false,
      daysRemaining: null,
      suspended: false,
      revoked: false,
      trial: false,
      trialExpired: false,
      gracePeriod: false,
      graceDaysRemaining: null
    });
    expect(getSubscriptionState({})).toEqual({
      active: false,
      daysRemaining: null,
      suspended: false,
      revoked: false,
      trial: false,
      trialExpired: false,
      gracePeriod: false,
      graceDaysRemaining: null
    });"""

content = re.sub(r"expect\(getSubscriptionState\(null\)\)\.toEqual\(\{\s*active:\s*false,\s*daysRemaining:\s*null,\s*suspended:\s*false,\s*revoked:\s*false,?\s*\}\);\s*expect\(getSubscriptionState\(\{\}\)\)\.toEqual\(\{\s*active:\s*false,\s*daysRemaining:\s*null,\s*suspended:\s*false,\s*revoked:\s*false,?\s*\}\);", replacement.strip(), content)

with open("tests/unit/subscription-state.test.js", "w", encoding="utf-8") as f:
    f.write(content)
