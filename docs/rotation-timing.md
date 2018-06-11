---
title: Rotation Timing
---

From the user perspective, this service is simple to use: request an AMQP
connection string with `pulse.claimNamespace`, and use the resulting connection
string to connect. That string can be re-used for new connections until its
`reclaimAt` time, after which it is not guaranteed to be valid.

## Implementation

This rotation pattern is implemented by creating two users for each namespace.
At any time, one is "active" and one is "standby". Passwords are reset for
standby users when they are promoted to primary. A primary user will keep the
same password when it becomes secondary.

The `reclaimAfter` value returned from `claimNamespace` is calculated as the
midpoint of the current primary user's secondary phase. This is conveniently
no sooner than half of the rotation interval, allowing plenty of room for clock
skew and for connections to be established.

In diagrammatic form:

```
user-1: AAAAASSSSSAAAAA..
user-2: SSSSSAAAAASSSSS..
time-->   X    Z  Y
```

User-1's password will be reset at time Y. A call to `claimNamespace` at time X
will return a `reclaimAfter` of Z, halfway through user-1's standby phase.
