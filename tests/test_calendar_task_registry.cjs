const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const staticJs = path.join(projectRoot, "src/timetrace/interfaces/api/static/js");

function makeElement(value = "") {
    return {
        value,
        checked: false,
        innerText: "",
        classList: { add() {}, remove() {} }
    };
}

test("saving a task refreshes the registry used to render its calendar session", async () => {
    const oldTask = { id: "old-task", title: "Existing task" };
    const createdTask = { id: "new-task", title: "Fresh task", estimated_minutes: 15 };
    let registryRows = [oldTask];
    let registryFetches = 0;
    const elements = new Map([
        ["edit_task_id", makeElement("")],
        ["modal_input_title", makeElement(createdTask.title)],
        ["modal_input_desc", makeElement("")],
        ["modal_input_tags", makeElement("")],
        ["modal_input_priority", makeElement("-")],
        ["modal_input_status", makeElement("To Do")],
        ["modal_input_category", makeElement("work")],
        ["modal_input_est", makeElement("15m")],
        ["modal_input_assigned_date", makeElement("")],
        ["modal_input_due_date", makeElement("")],
        ["modal_input_attachments", makeElement("")],
        ["modal_input_is_recurring", makeElement()],
        ["modal_input_recurrence_rule", makeElement("daily")],
        ["modal_input_requires_review", makeElement()],
        ["modal_input_color_mode", makeElement("auto")],
        ["modal_input_color", makeElement("#7c3aed")],
        ["task_modal", makeElement()]
    ]);
    elements.get("modal_input_requires_review").checked = true;

    const context = vm.createContext({
        document: {
            getElementById: id => elements.get(id) || null,
            addEventListener() {}
        },
        api: {
            async get() {
                registryFetches += 1;
                return registryRows;
            },
            async post() {
                registryRows = [oldTask, createdTask];
                return createdTask;
            }
        },
        parseFlexibleDateInput: () => null,
        parseDurationToMinutes: () => 15,
        fetchTasks() {},
        loadKanbanBoard() {},
        calendar: { refetchEvents() {}, unselect() {} },
        getTaskColor: () => "#7c3aed",
        defaultPalette: ["#7c3aed"]
    });

    for (const filename of ["task_attach.js", "calendar.js", "task_modal.js", "dashboard.js"]) {
        const source = fs.readFileSync(path.join(staticJs, filename), "utf8");
        vm.runInContext(source, context, { filename });
    }

    await vm.runInContext("fetchAllTasksRegistry()", context);
    await vm.runInContext("saveTask()", context);

    assert.equal(registryFetches, 2, "saving the task should reload the cached task registry");

    vm.runInContext('allTasksMap = { "old-task": { id: "old-task", title: "Existing task" } }', context);
    const resolvedTask = await vm.runInContext(
        `resolveCalendarDropTask("${createdTask.id}", "${createdTask.title}")`,
        context
    );
    const event = vm.runInContext(
        `formatCalEventFromSession({ id: "session-1", task_id: "${createdTask.id}", start_time: "2026-01-01T09:00:00Z", end_time: "2026-01-01T09:15:00Z" })`,
        context
    );

    assert.equal(registryFetches, 3, "calendar drops should refresh a stale task registry");
    assert.equal(resolvedTask.title, createdTask.title);
    assert.equal(event.title, createdTask.title);
    assert.equal(event.extendedProps.taskTitle, createdTask.title);
});
