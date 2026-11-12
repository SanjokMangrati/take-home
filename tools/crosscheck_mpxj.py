import importlib
import sys
from collections import Counter, defaultdict
from pathlib import Path

import jpype

HIGH_FLOAT_DAYS = 44
FLOAT_DAY_DECIMALS = 4
UNCHECKED_TYPES = {"LEVEL_OF_EFFORT", "WBS_SUMMARY"}


def only_one(tasks):
    ids = [int(task.getUniqueID()) for task in tasks]
    return set(ids) if len(ids) == 1 else set()


def activities_of(project):
    return [task for task in project.getTasks() if task.getActivityType() is not None]


def recount(project, hours):
    activities = activities_of(project)
    in_file = {int(task.getUniqueID()) for task in activities}
    links = [
        link
        for task in activities
        for link in task.getPredecessors()
        if int(link.getPredecessorTask().getUniqueID()) in in_file
    ]
    with_predecessor = {int(link.getSuccessorTask().getUniqueID()) for link in links}
    with_successor = {int(link.getPredecessorTask().getUniqueID()) for link in links}
    project_start = only_one(
        task
        for task in activities
        if str(task.getActivityType()) == "START_MILESTONE"
        and int(task.getUniqueID()) not in with_predecessor
    )
    project_finish = only_one(
        task
        for task in activities
        if str(task.getActivityType()) == "FINISH_MILESTONE"
        and int(task.getUniqueID()) not in with_successor
    )
    checked = [task for task in activities if is_checked(task)]
    measured = [task for task in checked if task.getTotalSlack() is not None]

    def missing_link(task):
        uid = int(task.getUniqueID())
        no_predecessor = uid not in with_predecessor and uid not in project_start
        no_successor = uid not in with_successor and uid not in project_finish
        return no_predecessor or no_successor

    return {
        "checked": len(checked),
        "missing links": sum(missing_link(task) for task in checked),
        "negative float": sum(task_float_hours(task, project, hours) < 0 for task in measured),
        "high float": sum(
            task_float_days(task, project, hours) > HIGH_FLOAT_DAYS for task in measured
        ),
    }


def by_activity_id(project):
    activities = activities_of(project)
    counts = Counter(str(task.getActivityID()) for task in activities)
    return {
        str(task.getActivityID()): task
        for task in activities
        if counts[str(task.getActivityID())] == 1
    }


def is_checked(task):
    return (
        str(task.getActivityStatus()) != "COMPLETED"
        and str(task.getActivityType()) not in UNCHECKED_TYPES
    )


def task_float_hours(task, project, hours):
    properties = project.getProjectProperties()
    return float(task.getTotalSlack().convertUnits(hours, properties).getDuration())


def task_float_days(task, project, hours):
    if task.getTotalSlack() is None:
        return None
    float_hours = task_float_hours(task, project, hours)
    minutes_per_day = float(task.getEffectiveCalendar().getCalendarMinutesPerDay())
    return round(float_hours / (minutes_per_day / 60), FLOAT_DAY_DECIMALS)


def relationships_by_pair(project, activities, hours):
    properties = project.getProjectProperties()
    pairs = defaultdict(list)
    for task in activities.values():
        for link in task.getPredecessors():
            predecessor = str(link.getPredecessorTask().getActivityID())
            if predecessor not in activities:
                continue
            lag = float(link.getLag().convertUnits(hours, properties).getDuration())
            pairs[(predecessor, str(task.getActivityID()))].append((str(link.getType()), lag))
    return {pair: sorted(relationships) for pair, relationships in pairs.items()}


def compare(before, after, hours):
    earlier = by_activity_id(before)
    later = by_activity_id(after)
    matched = [(earlier[code], later[code]) for code in earlier if code in later]
    open_in_both = [(old, new) for old, new in matched if is_checked(old) and is_checked(new)]
    changes = []
    for old, new in open_in_both:
        old_days = task_float_days(old, before, hours)
        new_days = task_float_days(new, after, hours)
        if old_days is not None and new_days is not None:
            changes.append((old_days, new_days, round(new_days - old_days, FLOAT_DAY_DECIMALS)))
    earlier_pairs = relationships_by_pair(before, earlier, hours)
    later_pairs = relationships_by_pair(after, later, hours)
    return {
        "completed": sum(
            str(old.getActivityStatus()) != "COMPLETED"
            and str(new.getActivityStatus()) == "COMPLETED"
            for old, new in matched
        ),
        "started": sum(
            str(old.getActivityStatus()) == "NOT_STARTED"
            and str(new.getActivityStatus()) == "IN_PROGRESS"
            for old, new in matched
        ),
        "added": sum(code not in earlier for code in later),
        "removed": sum(code not in later for code in earlier),
        "checked in both": len(open_in_both),
        "lost float": sum(change < 0 for _, _, change in changes),
        "gained float": sum(change > 0 for _, _, change in changes),
        "unchanged float": sum(change == 0 for _, _, change in changes),
        "now negative float": sum(old >= 0 > new for old, new, _ in changes),
        "relationship pairs changed": sum(
            earlier_pairs.get(pair, []) != later_pairs.get(pair, [])
            for pair in set(earlier_pairs) | set(later_pairs)
        ),
    }


def print_counts(label, counts):
    print(label, ", ".join(f"{name} {value:,}" for name, value in counts.items()))


def main():
    paths = sys.argv[1:]
    if not paths:
        sys.exit("usage: crosscheck_mpxj.py FILE.xer [FILE.xer ...]")
    for path in paths:
        if not Path(path).exists():
            sys.exit(f"{path}: no such file")
    importlib.import_module("mpxj")
    jpype.startJVM()
    hours = importlib.import_module("org.mpxj").TimeUnit.HOURS
    reader = importlib.import_module("org.mpxj.reader").UniversalProjectReader
    projects = []
    for path in paths:
        project = reader().read(path)
        if project is None:
            sys.exit(f"{path}: MPXJ could not read this file")
        projects.append(project)
    for path, project in zip(paths, projects, strict=True):
        print_counts(Path(path).name, recount(project, hours))
    for index in range(1, len(paths)):
        label = f"{Path(paths[index - 1]).name} to {Path(paths[index]).name}"
        print_counts(label, compare(projects[index - 1], projects[index], hours))


if __name__ == "__main__":
    main()
