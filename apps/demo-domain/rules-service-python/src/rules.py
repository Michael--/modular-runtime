from typing import Optional

from pipeline.v1 import pipeline_pb2

MIN_VALUE = 10


def apply_rules(event: pipeline_pb2.ParsedEvent) -> Optional[pipeline_pb2.EnrichedEvent]:
    value = int(event.value)
    passed = value >= MIN_VALUE and event.type != "view"

    if not passed:
        return None

    return pipeline_pb2.EnrichedEvent(
        event=event,
        metadata={"rule": "min_value_and_type"},
        passed_rules=True,
    )
