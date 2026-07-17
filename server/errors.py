"""Standard API error per PROJECT.md section 3: {"error": code, "message": text}."""


class ApiError(Exception):
    def __init__(self, status_code: int, error: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.error = error
        self.message = message
