# Todo list tool

## Goals

- Let a person keep a short list of things to do from the command line.

## Non-goals

- Syncing between computers.

## Scenarios

### S1: Add a task
Criterion: Running the add command with some text stores a new task and prints its number.
Proof: cli

### S2: See the list
Criterion: Running the list command shows every open task, one per line, oldest first.
Proof: cli

### S3: Finish a task
- Criterion: Running the done command with a task number marks it finished and hides it from the list.
- Proof: cli

## Non-functional needs

- Every command answers in under one second for a list of 1000 tasks.

## Risks

- A damaged data file could lose tasks; the tool must keep a backup.
