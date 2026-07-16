# Project Improvement Framework for AI Coding Agents

## Document Purpose

This is a practical, self-contained framework designed specifically for AI coding agents, or any autonomous AI assistant working on code, software projects, features, or technical implementations.

Use this framework autonomously on every task, feature, bug fix, refactoring, or full project you are working on. Apply it iteratively to turn mediocre or incomplete code into high-quality, robust, maintainable, and valuable software.

The goal is simple: systematically improve any piece of work from its current state to something significantly better through short, evidence-based cycles.

## Core Principles for AI Agents

- Always iterate in small, testable increments.
- Validate assumptions with code, tests, or user simulation before deep investment.
- Prioritize measurable value, maintainability, performance, and correctness.
- Manage technical debt aggressively; never let it accumulate unchecked.
- Document decisions lightly but clearly for traceability and future self-review.
- Adapt the depth of each step to the task size. Micro-changes can use lightweight versions; larger features need fuller cycles.
- End cycles with clear "ship / improve / pivot / kill" decisions.

## The Autonomous Improvement Cycle

Apply this cycle repeatedly.

### 1. Identify

Analyze the current code, feature, or project state and pinpoint what needs improvement.

- Review the existing implementation: functionality, bugs, edge cases, performance, readability, test coverage, architecture, and alignment with requirements.
- Gather baseline metrics: test coverage percentage, runtime, memory usage, error rates, and code complexity if measurable.
- Ask: What is broken, slow, unclear, insecure, or missing? What would "better" look like for this specific piece, such as a cleaner API, faster response, or higher reliability?
- Prioritize the highest-impact issues using simple impact-versus-effort reasoning.
- Define 1-3 concrete, measurable goals for this cycle, such as "increase test coverage from 40% to 85%", "reduce latency by 30%", or "eliminate all known edge-case failures".

Tooling tip: Use code analysis, linters, static analyzers, and reasoning over the full context. Run existing tests first.

### 2. Research & Plan

Understand root causes and create a focused improvement plan.

- Investigate why the issue exists. Check similar patterns in the codebase and review relevant documentation, libraries, or best practices, including clean code, design patterns, security guidelines, and performance techniques.
- Brainstorm multiple solution options, ideally 2-3, and evaluate trade-offs across complexity, performance, maintainability, and future extensibility.
- Choose the most promising approach for this cycle.
- Write a brief internal plan covering scope of changes, files or modules affected, new tests needed, success criteria, potential risks, and estimated effort.
- Keep the cycle scoped small. Aim for something that can be implemented and tested in one pass: minutes to hours for small tasks, up to a full session for larger features.

### 3. Validate

Test the planned approach with minimal code changes first.

- Create quick validation artifacts: unit tests for new logic, small prototypes or refactors in a temporary branch or isolated area, and simulated inputs for edge cases.
- Run targeted experiments: execute tests, measure performance, check for regressions, and simulate user flows.
- Analyze results honestly. Does the approach solve the identified problem? Are there new issues? Does it introduce technical debt?
- Apply a clear decision gate:
  - Persevere: Results are promising; proceed to build.
  - Pivot: Direction is wrong; adjust the approach, such as a different algorithm, architecture, or library.
  - Kill: Idea is flawed; discard it and return to Identify with a new angle.

Common AI pitfall to avoid: over-committing to the first elegant-looking solution without testing it.

### 4. Refine

Incorporate validation learnings and polish the plan.

- Update the approach based on test results and edge-case discoveries.
- Improve design: simplify where possible, add necessary abstractions, and enhance error handling, security, and documentation through comments or docstrings where useful.
- Address emerging technical debt immediately if the refactor is low-cost.
- Revise success criteria if needed and document key reasoning changes.

### 5. Build / Implement

Execute the refined changes cleanly and completely.

- Write or refactor code following project best practices: readability, consistency with project style, proper error handling, and useful logging where appropriate.
- Add or update tests, including unit, integration, or property-based tests where applicable, to cover changes and edge cases.
- Ensure the increment is functional, passes all tests, and maintains or improves overall code health.
- Optimize only where validation showed clear need.
- Include inline comments for non-obvious decisions.

### 6. Review & Act

Evaluate the results and decide next steps.

- Run the full test suite, performance checks, and manual review of changed code.
- Measure against cycle goals.
- Conduct a quick self-retrospective:
  - What worked well?
  - What still needs improvement?
  - What did I learn that applies to the broader project?
  - Any new issues or opportunities surfaced?
- Decide:
  - Ship / merge: Ready for integration.
  - Continue iterating: Loop back to Step 1 for further refinement on this or related areas.
  - Pivot or expand: Broaden scope if value is high.
- Log a short summary of the cycle, including changes made, metrics improved, and key lessons, for continuity in future sessions.
- Immediately start the next cycle on the next priority item or deeper improvement.

## Agent-Specific Guidelines

- Apply on every task. Use this cycle even for small bug fixes or one-line changes; it compounds into better code over time.
- Adjust cycle speed. For micro-tasks, compress into 1-2 reasoning passes. For features, run multiple full cycles.
- Manage technical debt. In every Build and Refine step, ask "Does this increase or decrease future maintenance cost?" Act to reduce debt.
- Maintain testing discipline. Do not implement behavior changes without corresponding tests. Aim for high coverage on new or changed code.
- Use quality gates. Code must be readable, testable, and follow project conventions before considering a cycle complete.
- Make autonomous decisions. When requirements are ambiguous, note assumptions and validate them.
- Respect resources. Break very large refactors into multiple focused cycles.
- Carry lessons forward. Use patterns learned across cycles and projects.

## When to Stop a Cycle or Project Element

Define "good enough" criteria upfront, such as passing all tests, meeting performance targets, and maintaining readable code. Avoid perfectionism that delays delivery. Move to the next valuable improvement instead.

## Benefits When Used Autonomously

- Consistent production of higher-quality code.
- Early detection and correction of flaws.
- Reduced technical debt and easier future maintenance.
- Faster overall progress through rapid, validated iterations.
- Built-in self-improvement loop for the agent itself.

## Instructions for AI Coding Agents

Copy and internalize this framework.

Before starting any new task or continuing work on existing code, explicitly run through the cycle steps in reasoning. Reference this document when planning responses.

At the end of each major response or task completion, briefly note which cycle steps were completed and what the next cycle will target.
