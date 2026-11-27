"""Bounded SQL tag attribution for explicit interval queries (no database access)."""


def tag_union_sql(selected_sql, groups, tag_index, per_task, split, tag_predicate, *, per_record=False):
    """Allocate before filtering; per-record domains sum unassigned intervals, including overlaps."""
    keys = "".join(", " + key for key in groups)
    domain = "id" if per_record else "task_id" if per_task else "'all'"
    tagged_keys = keys + (f", tag AS g{tag_index}" if tag_index is not None else "")
    output_groups = list(groups)
    if tag_index is not None:
        output_groups.append(f"g{tag_index}")
        output_groups.sort(key=lambda key: int(key[1:]))
    output = ", ".join(output_groups)
    columns = output + "," if output else ""
    group = " GROUP BY " + output if output else ""
    ctes = f"""WITH RECURSIVE raw AS ({selected_sql}),
      tokens(id,tag,rest) AS (
        SELECT id,'',TRIM(COALESCE(tags,'')) || ' ' FROM raw
        UNION ALL
        SELECT id,TRIM(SUBSTR(rest,1,INSTR(rest,' ')-1)),SUBSTR(rest,INSTR(rest,' ')+1)
        FROM tokens WHERE rest<>''
      ), hashed AS (SELECT DISTINCT id,tag FROM tokens WHERE tag LIKE '#%'),
      tags AS (
        SELECT id,tag FROM hashed UNION ALL
        SELECT id,'#general' FROM raw r WHERE NOT EXISTS (SELECT 1 FROM hashed h WHERE h.id=r.id)
      ), tagged AS (SELECT r.*,t.tag FROM raw r JOIN tags t ON r.id=t.id)
    """
    if split:
        joins = "".join(f" AND s.{key} IS t.{key}" for key in groups)
        ctes += f""", endpoints AS (
          SELECT {domain} AS domain{keys},a AS x FROM raw UNION
          SELECT {domain} AS domain{keys},b AS x FROM raw
        ), segments AS (
          SELECT *, LEAD(x) OVER (PARTITION BY domain{keys} ORDER BY x) AS y FROM endpoints
        ), active AS (
          SELECT DISTINCT s.domain{"".join(", s." + key for key in groups)},s.x,s.y,t.tag
          FROM segments s JOIN tagged t ON s.x<t.b AND s.y>t.a
            {"AND s.domain=t.id" if per_record else "AND s.domain=t.task_id" if per_task else ""}{joins}
          WHERE s.y>s.x
        ), allocated AS (
          SELECT *, (y-x)*1.0/COUNT(*) OVER (PARTITION BY domain{keys},x,y) AS credit FROM active
        ), retained AS (
          SELECT credit{tagged_keys} FROM allocated WHERE {tag_predicate}
        )
        SELECT {columns}COALESCE(SUM(credit),0)/1000000.0/3600 AS value,
          (SELECT COUNT(DISTINCT id) FROM tagged WHERE {tag_predicate}) AS n FROM retained{group}
        """
    else:
        group_keys = "".join(", " + key for key in output_groups)
        ctes += f""", selected AS (
          SELECT DISTINCT id,task_id,a,b{tagged_keys} FROM tagged WHERE {tag_predicate}
        ), prior AS (
          SELECT *,MAX(b) OVER (PARTITION BY {domain}{group_keys} ORDER BY a,b,id
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prior_end FROM selected
        ), islands AS (
          SELECT *,SUM(CASE WHEN prior_end IS NULL OR a>prior_end THEN 1 ELSE 0 END)
          OVER (PARTITION BY {domain}{group_keys} ORDER BY a,b,id) AS island FROM prior
        ), merged AS (
          SELECT {domain} AS domain{group_keys},MIN(a) AS a,MAX(b) AS b
          FROM islands GROUP BY {domain}{group_keys},island
        )
        SELECT {columns}COALESCE(SUM(b-a),0)/1000000.0/3600 AS value,
          (SELECT COUNT(DISTINCT id) FROM selected r
            WHERE {" AND ".join(f"r.{key} IS merged.{key}" for key in output_groups) or "1"}) AS n
          FROM merged{group}
        """
    if split:
        physical = tag_union_sql(selected_sql, groups, tag_index, per_task, False, tag_predicate, per_record=per_record)
        joins = " AND ".join(f"a.{key} IS p.{key}" for key in output_groups) or "1"
        columns = "".join(f"a.{key}," for key in output_groups)
        return (
            f"SELECT {columns}a.value AS value,p.n AS n,p.value*3600 AS physical_seconds "
            f"FROM ({ctes}) a JOIN ({physical}) p ON {joins}"
        )
    return ctes
