"""Structured native diagnostics; codes are assigned at the failure boundary."""


def issue(code, message, *, role=None, path=None, manifest=None, line=None,
          next_action="Inspect the reported source/configuration and retry; do not overwrite or migrate records automatically."):
    value = dict(code=code, message=str(message)[:4096], nextAction=next_action)
    for key, item in (("role", role), ("path", path), ("manifest", manifest), ("line", line)):
        if item is not None:
            value[key] = item
    return value


class DiagnosticError(ValueError):
    def __init__(self, code, message, **context):
        self.issue = issue(code, message, **context)
        location = self.issue.get("manifest") or self.issue.get("path")
        if location and self.issue.get("line"):
            location += ":" + str(self.issue["line"])
        super().__init__((location + ": " if location else "") + self.issue["message"])


def issues_for(error):
    # Never infer codes from exception wording. Unclassified failures stay unknown.
    return [error.issue] if isinstance(error, DiagnosticError) else [issue("operation_failed", str(error))]
