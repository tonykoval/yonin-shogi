package yonin

/** Standalone Yonin Shogi server. Starts on http://0.0.0.0:8080. */
object YoninShogiApp extends cask.Main {

  override def allRoutes = Seq(
    YoninShogiRoutes,
    StaticRoutes
  )

  override def host: String = sys.env.getOrElse("YONIN_HOST", "0.0.0.0")
  override def port: Int = sys.env.get("YONIN_PORT").flatMap(p => scala.util.Try(p.toInt).toOption).getOrElse(8080)
}
