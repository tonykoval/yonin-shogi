ThisBuild / version := "1.0.0"

ThisBuild / scalaVersion := "2.13.18"

lazy val root = (project in file("."))
  .settings(
    name := "yonin-shogi",
    run / fork := true,
    assembly / mainClass := Some("yonin.YoninShogiApp")
  )

libraryDependencies ++= Seq(
  "com.lihaoyi" %% "cask" % "0.11.3",
  "com.lihaoyi" %% "scalatags" % "0.13.1",
  "com.lihaoyi" %% "ujson" % "4.4.1",
  "ch.qos.logback" % "logback-classic" % "1.5.16"
)

assembly / assemblyMergeStrategy := {
  case PathList("META-INF", "services", _*) => MergeStrategy.concat
  case PathList("META-INF", xs @ _*) => MergeStrategy.discard
  case x => MergeStrategy.first
}
