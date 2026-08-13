class TimeTraceError(Exception):
    """Base exception for all TimeTrace domain errors."""
    pass


class EntityNotFoundError(TimeTraceError):
    """Raised when a requested database entity does not exist."""
    def __init__(self, entity_name: str, entity_id: str | int):
        self.entity_name = entity_name
        self.entity_id = entity_id
        super().__init__(f"{entity_name} #{entity_id} not found.")


class TimerError(TimeTraceError):
    """Raised when an invalid timer operation is performed."""
    pass


class ValidationError(TimeTraceError):
    """Raised when business logic validation fails."""
    pass
