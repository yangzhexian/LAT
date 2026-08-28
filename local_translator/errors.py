class LlamaError(RuntimeError):
    """Base error for the managed llama.cpp runtime."""


class DownloadCancelled(LlamaError):
    """Raised when a runtime or model download is cancelled by the user."""


class ChecksumMismatch(LlamaError):
    """Raised when a completed asset does not match its release checksum."""


class LlamaHTTPError(LlamaError):
    """HTTP error returned by the local llama.cpp server."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
