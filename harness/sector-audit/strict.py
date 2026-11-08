"""Stricter identity test for a candidate official site (used by find_sites.py)."""
import re


def legal_phrase(name):
    base = re.sub(r"\b(ltd|limited)\.?\s*$", "", name.strip(), flags=re.I).strip()
    base = re.sub(r"\s*\((india|i)\)\s*", " ", base, flags=re.I).strip()
    words = [re.escape(w) for w in re.findall(r"[A-Za-z0-9]+", base.replace("&", " and "))]
    return re.compile(r"\b" + r"[\W_]*(?:and[\W_]*)?(?:\(?india\)?[\W_]*)?".join(words) + r"[\W_]*(?:\(?india\)?[\W_]*)?(?:ltd|limited|pvt|private)?", re.I) if words else None


INDIA = re.compile(r"india|mumbai|delhi|chennai|bengaluru|bangalore|kolkata|hyderabad|pune|ahmedabad|gujarat|noida|gurugram|"
                   r"₹|crore|lakh|cin|bse|nse|sebi", re.I)


def strict_ok(name, text, host, toks):
    """Domain match alone is not enough (ethos.com, responsive.io are foreign namesakes): it also needs an India marker."""
    joined = "".join(toks)
    h = host.replace("-", "")
    if len(joined) >= 5 and joined in h and (INDIA.search(text) or host.endswith(".in")):
        return True, "domain carries the full name and page is Indian"
    rx = legal_phrase(name)
    if rx and re.search(rx.pattern.rsplit("(?:ltd", 1)[0] + r"(?:ltd|limited)\b", text, re.I):
        return True, "page states the legal name"
    return False, "legal name not on page and domain lacks full name"
