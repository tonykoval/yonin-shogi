package yonin

import java.io.ByteArrayOutputStream

/** Serves bundled JS and CSS from the classpath (src/main/resources). */
object StaticRoutes extends cask.Routes {

  private def readResource(path: String): Option[Array[Byte]] = {
    Option(getClass.getClassLoader.getResourceAsStream(path)).map { stream =>
      try {
        val buffer = new ByteArrayOutputStream()
        val data = new Array[Byte](8192)
        var n = stream.read(data)
        while (n != -1) {
          buffer.write(data, 0, n)
          n = stream.read(data)
        }
        buffer.toByteArray
      } finally stream.close()
    }
  }

  private def contentType(path: String): String =
    if (path.endsWith(".js")) "application/javascript; charset=utf-8"
    else if (path.endsWith(".css")) "text/css; charset=utf-8"
    else if (path.endsWith(".json")) "application/json; charset=utf-8"
    else if (path.endsWith(".svg")) "image/svg+xml"
    else if (path.endsWith(".png")) "image/png"
    else "application/octet-stream"

  // Reject path traversal.
  private def safe(path: String): Boolean = !path.contains("..")

  private def serve(resourcePath: String, requestPath: String): cask.Response[Array[Byte]] = {
    if (!safe(requestPath)) {
      cask.Response(Array.emptyByteArray, statusCode = 400)
    } else {
      readResource(resourcePath) match {
        case Some(bytes) =>
          cask.Response(bytes, headers = Seq(
            "Content-Type" -> contentType(requestPath),
            "Cache-Control" -> "public, max-age=3600"
          ))
        case None =>
          cask.Response(Array.emptyByteArray, statusCode = 404)
      }
    }
  }

  @cask.get("/js/:path", subpath = true)
  def js(path: String, request: cask.Request): cask.Response[Array[Byte]] =
    serve("js/" + path, path)

  @cask.get("/assets/css/:path", subpath = true)
  def css(path: String, request: cask.Request): cask.Response[Array[Byte]] =
    serve("assets/css/" + path, path)

  initialize()
}
