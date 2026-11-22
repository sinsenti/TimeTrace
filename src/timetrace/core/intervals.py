"""Positive half-open intervals; endpoints must share one ordered UTC/time domain."""


def union[T](intervals: list[tuple[T, T]]) -> list[tuple[T, T]]:
    result = []
    for start, end in sorted(intervals):
        if end <= start:
            raise ValueError("Intervals must be positive")
        if result and start <= result[-1][1]:
            result[-1] = (result[-1][0], max(end, result[-1][1]))
        else:
            result.append((start, end))
    return result


def intersection[T](left: list[tuple[T, T]], right: list[tuple[T, T]]) -> list[tuple[T, T]]:
    a, b = union(left), union(right)
    result = []
    i = j = 0
    while i < len(a) and j < len(b):
        start, end = max(a[i][0], b[j][0]), min(a[i][1], b[j][1])
        if start < end:
            result.append((start, end))
        if a[i][1] < b[j][1]:
            i += 1
        else:
            j += 1
    return result


def difference[T](left: list[tuple[T, T]], right: list[tuple[T, T]]) -> list[tuple[T, T]]:
    result = union(left)
    for cut_start, cut_end in union(right):
        remaining = []
        for start, end in result:
            if cut_end <= start or cut_start >= end:
                remaining.append((start, end))
            else:
                if start < cut_start:
                    remaining.append((start, cut_start))
                if cut_end < end:
                    remaining.append((cut_end, end))
        result = remaining
    return result


def envelope[T](intervals: list[tuple[T, T]]) -> tuple[T, T] | None:
    merged = union(intervals)
    return (merged[0][0], merged[-1][1]) if merged else None
