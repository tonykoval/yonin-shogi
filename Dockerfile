# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────
# Build stage: compile and assemble the fat JAR with sbt-assembly
# ─────────────────────────────────────────────────────────────
FROM eclipse-temurin:17-jdk-jammy AS build

# sbt is just a launcher; it bootstraps the version pinned in
# project/build.properties (1.11.7) on first run.
ARG SBT_VERSION=1.11.7
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL "https://github.com/sbt/sbt/releases/download/v${SBT_VERSION}/sbt-${SBT_VERSION}.tgz" \
       | tar -xz -C /opt
ENV PATH="/opt/sbt/bin:${PATH}"

WORKDIR /app

# 1) Resolve dependencies first so this layer is cached unless the
#    build definition changes.
COPY project/build.properties project/plugins.sbt project/
COPY build.sbt .
RUN sbt -batch -Dsbt.color=false update

# 2) Build the assembly jar. Copied second so source edits don't
#    bust the dependency cache above.
COPY src/ src/
RUN sbt -batch -Dsbt.color=false assembly \
    && cp target/scala-2.13/*assembly*.jar app.jar

# ─────────────────────────────────────────────────────────────
# Runtime stage: slim JRE, just the jar
# ─────────────────────────────────────────────────────────────
FROM eclipse-temurin:17-jre-jammy AS runtime

WORKDIR /app
COPY --from=build /app/app.jar app.jar

# YoninShogiApp reads these (see YoninShogiApp.scala).
ENV YONIN_HOST=0.0.0.0 \
    YONIN_PORT=8080 \
    JAVA_OPTS="-XX:MaxRAMPercentage=75.0"

EXPOSE 8080

# sh -c so $JAVA_OPTS expands; exec so the JVM is PID 1 and receives signals.
ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar app.jar"]
