# Capstone Group 17

## Client Meeting Notes --- A Tool for Comparing Neural Network Verifiers

**Date:** 3 August 2026\
**Duration:** 46 minutes\
**Meeting Type:** Client / Project Requirements Discussion

## Participants

**Client:** Matthew Daggitt

**Students:** - Thanh Hung Nguyen - Sagar Ganagi - Qiumei Wang - Robin
Varughese Mathew

## 1. Meeting Purpose

The purpose of the meeting was to clarify the project problem, expected
system functionality, technical structure, development stages, and
communication arrangements with the client.

The client explained that neural network verification uses a constraint
language to describe conditions on a neural network's inputs, outputs,
and, in some cases, internal values. A solver determines whether an
input exists that satisfies those constraints.

The key project problem is that different neural network solvers support
different subsets of VNN-LIB features, but there is currently no
convenient central place where users can determine which solver supports
a particular verification problem. The project therefore aims to collect
solver capability information automatically and provide a way for users
to search for compatible solvers.

## 2. Overall Project Structure

The client described the project as having three main stages.

### Stage 1 --- Solver Registration and Capability Database

Solver developers should be able to contribute a solver by submitting an
installation script through a GitHub Pull Request.

Proposed workflow:

1.  A solver developer submits an installation script for a solver
    version.
2.  The submitted script is reviewed before merging.
3.  The solver is installed temporarily in an automated environment.
4.  The system runs the VNN-LIB 2.0 `supports` interface.
5.  The solver capabilities are extracted and recorded.
6.  The installed solver can then be discarded because the project does
    not need to run verification problems.

The client stressed that the project only needs to use the solver
capabilities/`supports` interface. Running the solver's actual
verification function is outside the required scope.

**VibeCheck** was suggested as the first test solver because it is known
to support the VNN-LIB 2.0 interface and is relatively easy to install.

A traditional database may not be necessary because the expected number
of solvers is relatively small. A structured text-based data format
could be sufficient if it is maintainable and easy for the Python
package and website to consume.

### Stage 2 --- Python Search Package

The second stage is to create a proper installable Python package that
reads the solver capability data and returns solvers compatible with a
user's requirements.

-   The package should be usable from the command line.
-   The package should also expose Python functions for programmatic
    use.
-   Users provide the relevant characteristics of their verification
    problem.
-   The package returns a list of solvers that satisfy those
    requirements.

The client described this as a reverse lookup of the `supports`
information.

Partial queries must be supported: users should not be required to
specify every possible capability. Any field that is not specified
should not restrict the results.

### Stage 3 --- Website Search Interface

The third stage is to update the current VNN-LIB website so users can
interact with the compatibility system through a web interface.

The current site is largely a single-page static website. The client
would like it reorganised into multiple pages, including a dedicated
**Solvers** page and a separate **Libraries** page, while retaining
useful existing content such as **Latest News**.

The Solvers page should display all known solvers by default and provide
search/filter controls at the top so users can identify compatible
solvers based on capability requirements.

The current site is hosted as a static GitHub Pages site. The team can
initially build the new system in its own repository/server environment,
while final deployment and domain hosting details are resolved later
with the relevant website/domain owner.

## 3. Solver Search Criteria

The search system should use capability information produced by the
VNN-LIB `supports` command.

Search criteria discussed during the meeting included:

-   Numeric types supported by a solver.
-   Hidden node support.
-   Multiple network support.
-   Multiple input/output support.
-   Supported VNN-LIB theories/logics.
-   Other network/query capability fields defined by the standard.
-   ONNX operators or neural-network layer/node types.

The client highlighted ONNX operators because different solvers support
different neural-network node types, such as `Add`, `Conv`, and
`MaxPool`.

For the core project, this is mainly a capability matching/string
matching problem; the team does not need to implement the mathematical
operations themselves.

## 4. Optional ONNX Network Feature

The client proposed a bonus feature for the Python package. Instead of
requiring users to manually enter all ONNX operators contained in a
neural network, the package could accept an ONNX network file directly.

The package could then:

1.  Read the network.
2.  Collect the node/layer types.
3.  Call the normal compatibility search interface with those operator
    requirements.
4.  Return compatible solvers.

If implemented in the Python package, the same functionality could later
be exposed through the website as a network upload feature.

The client explicitly stated that this feature is **optional** and
should not distract the team from completing the core system first.

## 5. Solver Version Management

The system should be version-aware. Multiple versions of the same solver
may have different capability sets, so the database should retain
capability information for each submitted solver version.

-   Store multiple versions for each solver.
-   Store the capability set associated with each version.
-   Do not assume that a newer version always supports every feature
    supported by an older version.
-   Where useful, show which solver version or version range supports a
    capability.

The client noted that a solver can sometimes remove support for a
feature in a later version, so historical capability information should
be preserved rather than overwritten.

## 6. GitHub and Automation Workflow

The proposed contribution and automation workflow is based on GitHub
Pull Requests and GitHub Actions.

-   A contributor adds or updates a solver installation script in the
    repository.
-   The contributor opens a Pull Request.
-   A reviewer checks the Pull Request and installation script.
-   After approval and merge, an automated workflow installs the solver
    and queries its `supports` interface.
-   The extracted capabilities are written into the data store
    automatically.

The client suggested using a dedicated Pull Request label for solver
submissions. This would allow the capability-extraction workflow to run
only when a PR is specifically adding or updating a solver, rather than
on every normal code change.

Human review remains important because installation scripts execute
arbitrary commands and could contain unsafe or malicious behaviour. The
client expects the long-term maintainer to be able to review the
submitted script and then merge it with minimal additional manual work.

## 7. Repository and Package Deployment

The client indicated that a new project repository would be created and
initially kept private. Team members need to provide their GitHub
usernames so that write access can be granted.

The client also suggested automating publication of the Python package.
For example, pushing a new version tag to GitHub could trigger a
workflow that builds the package and publishes the new version to PyPI
automatically.

The source code for the existing VNN-LIB website will be made available
so that the website work can start from the current implementation
rather than being rebuilt from scratch.

## 8. Parallel Development

The client confirmed that different parts of the project can be
developed in parallel if the team first defines the interfaces between
the components.

-   One group can work on solver submission, capability extraction and
    data generation.
-   Another group can work on the Python compatibility package.
-   Another group can work on the website/front-end.

To support parallel work, the team should agree early on the data format
and the Python package interface, including expected function names and
inputs/outputs.

## 9. VNN Competition Clarification

The team asked whether solver information or installation scripts from
the VNN Competition could be reused.

The client explained that the competition mainly focuses on running
solver verification commands, while this project is interested in the
`supports` command and capability information.

The competition does not currently provide the same installation-script
workflow required by this project. However, the client said they could
investigate existing verifier installation information and provide
additional solvers for testing after the initial system works with
VibeCheck.

## 10. Metadata Scope

The team asked whether additional solver metadata should be stored
beyond the `supports` interface.

The client said that extra metadata is not currently required. The
priority is to implement the core capability fields and matching
functionality correctly before considering additional information or
advanced features.

## 11. Use of AI / LLM Tools

The client confirmed that the team is allowed to use LLM tools to assist
with development, including tasks such as generating examples of GitHub
workflows.

However, the team remains responsible for correctness. The client
strongly emphasised understanding the generated code, reviewing it
carefully, and carrying out thorough peer code review because the final
system is expected to be robust, maintainable and potentially used as a
live system.

## 12. Ongoing Client Meetings

The client suggested meeting approximately **once every two weeks**
because the project involves a new standard and several technical
complexities.

The exact recurring time was **not fixed during this meeting**. The team
was asked to send several suitable meeting times.

Not every team member must attend every client meeting, provided enough
members attend to demonstrate progress across the different project
components.

For questions that cannot wait until the next meeting, the team can
contact the client through Microsoft Teams.

## 13. Intended Final Workflow

The client's preferred final system is highly automated and should
require very little ongoing manual maintenance:

**Solver developer submits PR → Reviewer checks PR → PR is merged →
Solver capabilities are extracted automatically → Capability data is
updated → Python package and website use the updated data.**