import { useState } from 'react';
import { activities, unassigned } from './agenda-tools';

const choices = activities.map(({ title }) => title);

export function TaskLauncher({
  selected,
  canStart,
  choose,
  start,
}: {
  selected: string;
  canStart: boolean;
  choose: (title: string) => void;
  start: (title: string) => void;
}) {
  const [query, setQuery] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [active, setActive] = useState(-1);
  const value = query ?? (selected === unassigned ? '' : selected);
  const term = value.trim().toLowerCase();
  const matches = choices.filter((title) => title.toLowerCase().includes(term));
  const exact = choices.find((title) => title.toLowerCase() === term);
  const current = query === null ? selected : exact;
  const show = expanded && matches.length > 0;

  function pick(title: string) {
    choose(title);
    setQuery(null);
    setActive(-1);
    setExpanded(false);
  }
  function startChosen(title: string) {
    if (!canStart) return;
    pick(title);
    start(title);
  }
  return (
    <section className="card task-launcher" aria-label="Timer launcher">
      <div className="launcher-row">
        <div className="launcher-field">
          <label>
            Task to time
            <input
              type="search"
              role="combobox"
              autoComplete="off"
              aria-autocomplete="list"
              aria-expanded={show}
              aria-controls="timer-task-matches"
              aria-activedescendant={show && active >= 0 ? `timer-task-match-${active}` : undefined}
              placeholder="Find an activity…"
              value={value}
              onFocus={() => setExpanded(true)}
              onBlur={() => {
                setExpanded(false);
                setActive(-1);
              }}
              onChange={(event) => {
                setQuery(event.target.value);
                setExpanded(true);
                setActive(-1);
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === 'Escape') {
                  setExpanded(false);
                  setActive(-1);
                  return;
                }
                if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && matches.length) {
                  event.preventDefault();
                  setExpanded(true);
                  const step = event.key === 'ArrowDown' ? 1 : -1;
                  setActive(
                    active < 0
                      ? step > 0
                        ? 0
                        : matches.length - 1
                      : (active + step + matches.length) % matches.length,
                  );
                }
                if (event.key === 'Enter') {
                  event.preventDefault();
                  const title = show && active >= 0 ? matches[active] : current;
                  if (!title || title === unassigned) return;
                  if (canStart) startChosen(title);
                  else pick(title);
                }
              }}
            />
          </label>
          <ul id="timer-task-matches" role="listbox" aria-label="Matching activities" hidden={!show}>
            {matches.map((title, index) => (
              <li
                id={`timer-task-match-${index}`}
                role="option"
                aria-selected={index === active}
                key={title}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(title)}
              >
                {title}
              </li>
            ))}
          </ul>
        </div>
        <div className="button-row">
          <button
            className="primary"
            disabled={!canStart || !current || current === unassigned}
            onClick={() => current && startChosen(current)}
          >
            Start timer
          </button>
          <button disabled={!canStart} onClick={() => startChosen(unassigned)}>
            Start unassigned
          </button>
        </div>
      </div>
      {expanded && !matches.length && (
        <p className="hint" role="status">
          No matching activity.
        </p>
      )}
    </section>
  );
}
