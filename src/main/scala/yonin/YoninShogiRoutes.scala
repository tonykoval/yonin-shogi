package yonin

import scalatags.Text.all._

import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import scala.collection.mutable

/**
 * Yonin Shogi (4-player shogi). All rules / move-generation / check / checkmate
 * logic is client-side in yonin-shogi.js; the server only relays moves for online
 * multiplayer rooms and is NOT rules-aware. Solo (vs bots) and the tutorial run
 * entirely in the browser.
 */
object YoninShogiRoutes extends cask.Routes {

  // ── In-memory room storage ──────────────────────────────
  case class PlayerSlot(
    name: String = "",
    connected: Boolean = false,
    alive: Boolean = true,
    hand: mutable.Map[Int, Int] = mutable.Map(0 -> 0, 1 -> 0, 2 -> 0, 3 -> 0)
  )

  case class Room(
    id: String,
    players: Array[PlayerSlot] = Array.fill(4)(PlayerSlot()),
    moves: mutable.ArrayBuffer[ujson.Value] = mutable.ArrayBuffer.empty,
    var status: String = "waiting",     // waiting | playing | finished
    var currentPlayer: Int = 0,
    var winner: Option[Int] = None,
    var createdAt: Long = System.currentTimeMillis()
  )

  private val rooms = new ConcurrentHashMap[String, Room]()

  // Cleanup old rooms (>24h) periodically
  private def cleanupOldRooms(): Unit = {
    val cutoff = System.currentTimeMillis() - 24 * 3600 * 1000
    rooms.entrySet().removeIf(e => e.getValue.createdAt < cutoff)
  }

  // ── Request helpers ─────────────────────────────────────
  // Language is chosen via the /lang/:code route (sets a cookie); content pages
  // just read that cookie. Cask rejects undeclared query params, so we avoid
  // switching language with a ?lang= param on content pages.
  private def getLang(request: cask.Request): String =
    I18n.validateLang(request.cookies.get("lang").map(_.value).getOrElse(I18n.defaultLang))

  private val noCacheHeaders = Seq(
    "Cache-Control" -> "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma" -> "no-cache"
  )

  private def noCacheRedirect(location: String): cask.Response[String] =
    cask.Response("", statusCode = 302, headers = Seq("Location" -> location) ++ noCacheHeaders)

  private def htmlResponse(body: String, request: cask.Request): cask.Response[String] =
    cask.Response(body, headers = Seq("Content-Type" -> "text/html; charset=utf-8"))

  private def json(value: ujson.Value): cask.Response[ujson.Value] =
    cask.Response(value, headers = Seq("Content-Type" -> "application/json"))

  // ── Pages ───────────────────────────────────────────────

  // Switch UI language: set the cookie and bounce back to the page we came from.
  @cask.get("/lang/:code")
  def setLang(code: String, request: cask.Request) = {
    val valid = I18n.validateLang(code)
    val back = request.headers.get("referer").flatMap(_.headOption).getOrElse("/yonin-shogi")
    cask.Response("", statusCode = 302, headers = Seq(
      "Location" -> back,
      "Set-Cookie" -> s"lang=$valid; Path=/; SameSite=Strict"
    ) ++ noCacheHeaders)
  }

  @cask.get("/")
  def rootPage(request: cask.Request) = lobbyPage(request)

  @cask.get("/yonin-shogi")
  def lobbyPage(request: cask.Request) = {
    implicit val lang: String = getLang(request)
    htmlResponse(renderLobbyPage().render, request)
  }

  @cask.get("/yonin-shogi/game/:roomId")
  def gamePage(roomId: String, request: cask.Request) = {
    implicit val lang: String = getLang(request)
    if (!rooms.containsKey(roomId)) noCacheRedirect("/yonin-shogi")
    else htmlResponse(renderGamePage(roomId).render, request)
  }

  // Interactive rules tutorial — runs entirely client-side.
  @cask.get("/yonin-shogi/tutorial")
  def tutorialPage(request: cask.Request) = {
    implicit val lang: String = getLang(request)
    htmlResponse(renderTutorialPage().render, request)
  }

  // Single-player game against bots — runs entirely client-side, no room needed.
  @cask.get("/yonin-shogi/solo")
  def soloPage(request: cask.Request, bots: Int = 3) = {
    implicit val lang: String = getLang(request)
    val clampedBots = math.max(1, math.min(3, bots))
    htmlResponse(renderGamePage("", soloBots = Some(clampedBots)).render, request)
  }

  // ── API ─────────────────────────────────────────────────

  @cask.post("/yonin-shogi/api/create")
  def apiCreate(request: cask.Request) = {
    cleanupOldRooms()
    val id = UUID.randomUUID().toString.take(8)
    rooms.put(id, Room(id = id))
    json(ujson.Obj("roomId" -> id))
  }

  @cask.post("/yonin-shogi/api/join/:roomId")
  def apiJoin(roomId: String, request: cask.Request) = {
    val room = rooms.get(roomId)
    if (room == null) {
      json(ujson.Obj("success" -> false, "error" -> "Room not found"))
    } else {
      val data = ujson.read(request.text())
      val seat = data("seat").num.toInt
      val name = data("name").str.take(20)

      if (seat < 0 || seat > 3) {
        json(ujson.Obj("success" -> false, "error" -> "Invalid seat"))
      } else if (room.players(seat).connected) {
        json(ujson.Obj("success" -> false, "error" -> "Seat taken"))
      } else {
        room.synchronized {
          room.players(seat) = PlayerSlot(name = name, connected = true)
        }
        json(ujson.Obj("success" -> true))
      }
    }
  }

  @cask.post("/yonin-shogi/api/start/:roomId")
  def apiStart(roomId: String, request: cask.Request) = {
    val room = rooms.get(roomId)
    if (room == null) {
      json(ujson.Obj("success" -> false, "error" -> "Room not found"))
    } else {
      room.synchronized {
        val connectedCount = room.players.count(_.connected)
        if (connectedCount < 2) {
          json(ujson.Obj("success" -> false, "error" -> "Need at least 2 players"))
        } else if (room.status != "waiting") {
          json(ujson.Obj("success" -> false, "error" -> "Game already started"))
        } else {
          room.status = "playing"
          // Mark unconnected players as not alive
          for (i <- 0 until 4) {
            if (!room.players(i).connected) {
              room.players(i) = room.players(i).copy(alive = false)
            }
          }
          // Find first connected player
          room.currentPlayer = room.players.indexWhere(_.connected)
          json(ujson.Obj("success" -> true))
        }
      }
    }
  }

  @cask.get("/yonin-shogi/api/state/:roomId")
  def apiState(roomId: String, request: cask.Request) = {
    val room = rooms.get(roomId)
    if (room == null) {
      json(ujson.Obj("error" -> "Room not found"))
    } else {
      val playersJson = ujson.Arr(room.players.zipWithIndex.map { case (p, i) =>
        ujson.Obj(
          "id" -> i,
          "name" -> p.name,
          "connected" -> p.connected,
          "alive" -> p.alive,
          "hand" -> ujson.Obj("0" -> p.hand(0), "1" -> p.hand(1), "2" -> p.hand(2), "3" -> p.hand(3))
        )
      }.toIndexedSeq: _*)

      json(ujson.Obj(
        "roomId" -> room.id,
        "status" -> room.status,
        "currentPlayer" -> room.currentPlayer,
        "players" -> playersJson,
        "moves" -> ujson.Arr(room.moves.toSeq: _*),
        "winner" -> (room.winner match { case Some(w) => ujson.Num(w); case None => ujson.Null })
      ))
    }
  }

  @cask.post("/yonin-shogi/api/move/:roomId")
  def apiMove(roomId: String, request: cask.Request) = {
    val room = rooms.get(roomId)
    if (room == null) {
      json(ujson.Obj("success" -> false, "error" -> "Room not found"))
    } else {
      val data = ujson.read(request.text())
      val seat = data("seat").num.toInt
      val move = data("move")

      room.synchronized {
        if (room.status != "playing") {
          json(ujson.Obj("success" -> false, "error" -> "Game not in progress"))
        } else if (seat != room.currentPlayer) {
          json(ujson.Obj("success" -> false, "error" -> "Not your turn"))
        } else {
          // Store the move
          room.moves += move

          // Advance turn to next alive player
          var next = (room.currentPlayer + 1) % 4
          var attempts = 0
          while (!room.players(next).alive && attempts < 4) {
            next = (next + 1) % 4
            attempts += 1
          }
          room.currentPlayer = next

          // Check if game is over (1 player left)
          val alivePlayers = room.players.zipWithIndex.filter(_._1.alive)
          if (alivePlayers.length <= 1) {
            room.status = "finished"
            room.winner = alivePlayers.headOption.map(_._2)
          }

          json(ujson.Obj("success" -> true))
        }
      }
    }
  }

  // Server-side elimination notification from client
  @cask.post("/yonin-shogi/api/eliminate/:roomId")
  def apiEliminate(roomId: String, request: cask.Request) = {
    val room = rooms.get(roomId)
    if (room == null) {
      json(ujson.Obj("success" -> false))
    } else {
      val data = ujson.read(request.text())
      val loser = data("loser").num.toInt

      room.synchronized {
        if (loser >= 0 && loser < 4) room.players(loser) = room.players(loser).copy(alive = false)
        // Check if game over
        val alivePlayers = room.players.zipWithIndex.filter(_._1.alive)
        if (alivePlayers.length <= 1) {
          room.status = "finished"
          room.winner = alivePlayers.headOption.map(_._2)
        }
      }
      json(ujson.Obj("success" -> true))
    }
  }

  // ── HTML rendering ──────────────────────────────────────

  def renderLobbyPage()(implicit lang: String) = {
    tag("html")(attr("lang") := lang, cls := "dark")(
      Layout.headFrag(I18n.t("yonin.pageTitle")),
      body(cls := "wood")(
        Layout.headerFrag,
        div(cls := "container py-4 text-center")(
          h1(cls := "display-5 fw-bold mb-3")(
            i(cls := "bi bi-people-fill me-3", style := "color: #e8a317;"),
            I18n.t("yonin.pageTitle")
          ),
          p(cls := "lead text-light-50 mb-4")(I18n.t("yonin.subtitle")),

          div(cls := "mb-4")(
            a(cls := "btn btn-outline-info btn-lg", href := "/yonin-shogi/tutorial")(
              i(cls := "bi bi-mortarboard-fill me-2"),
              I18n.t("yonin.tutorial")
            )
          ),

          // ── Play vs Bots (solo) ──
          div(cls := "card bg-dark text-light border-warning mx-auto mb-4", style := "max-width: 500px;")(
            div(cls := "card-body")(
              h5(cls := "card-title")(
                i(cls := "bi bi-robot me-2", style := "color: #e8a317;"),
                I18n.t("yonin.soloTitle")
              ),
              p(cls := "mb-3 text-light-50")(I18n.t("yonin.soloDesc")),
              div(cls := "mb-3")(
                label(cls := "form-label small")(I18n.t("yonin.numBots")),
                select(id := "ys-bot-count", cls := "form-select bg-dark text-light border-secondary mx-auto",
                  style := "max-width: 200px;")(
                  option(value := "1")("1"),
                  option(value := "2")("2"),
                  option(value := "3", selected := "selected")("3")
                )
              ),
              button(cls := "btn btn-warning btn-lg", id := "ys-solo-btn")(
                i(cls := "bi bi-play-circle me-2"),
                I18n.t("yonin.playSolo")
              )
            )
          ),

          div(cls := "text-light-50 mb-3")(I18n.t("yonin.orDivider")),

          div(cls := "card bg-dark text-light border-secondary mx-auto", style := "max-width: 500px;")(
            div(cls := "card-body")(
              p(cls := "mb-3")(I18n.t("yonin.createDesc")),
              div(cls := "mb-3")(
                input(`type` := "text", id := "ys-lobby-name", cls := "form-control bg-dark text-light border-secondary",
                  placeholder := I18n.t("yonin.namePlaceholder"), maxlength := "20")
              ),
              button(cls := "btn btn-outline-warning btn-lg", id := "ys-create-btn")(
                i(cls := "bi bi-plus-circle me-2"),
                I18n.t("yonin.createGame")
              )
            )
          ),

          div(cls := "mt-5")(
            h5(I18n.t("yonin.rulesTitle")),
            div(cls := "text-start text-light-50 mx-auto", style := "max-width: 600px;")(
              ul(
                li(I18n.t("yonin.rule1")),
                li(I18n.t("yonin.rule2")),
                li(I18n.t("yonin.rule3")),
                li(I18n.t("yonin.rule4")),
                li(I18n.t("yonin.rule5")),
                li(I18n.t("yonin.rule6"))
              )
            )
          )
        ),
        script(src := "https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"),
        script(raw(s"window.i18n = ${I18n.messagesAsJson(lang)};")),
        script(src := "/js/yonin-shogi.js"),
        script(raw("YoninShogi.initLobbyPage();"))
      )
    )
  }

  def renderGamePage(roomId: String, soloBots: Option[Int] = None)(implicit lang: String) = {
    val isSolo = soloBots.isDefined
    val initScript = soloBots match {
      case Some(n) => s"YoninShogi.initSoloGame($n);"
      case None    => s"YoninShogi.initGamePage('$roomId');"
    }
    tag("html")(attr("lang") := lang, cls := "dark")(
      Layout.headFrag(s"${I18n.t("yonin.pageTitle")} - Game"),
      body(cls := "wood")(
        Layout.headerFrag,

        // ── Lobby overlay (hidden in solo mode) ──
        div(id := "ys-lobby", style := (if (isSolo) "display:none;" else ""))(
          div(cls := "container py-4 text-center")(
            h3(cls := "mb-3")(
              i(cls := "bi bi-people-fill me-2"),
              I18n.t("yonin.roomTitle")
            ),
            p(cls := "text-light-50 mb-2")(I18n.t("yonin.shareLink")),
            div(cls := "mb-3")(
              button(cls := "btn btn-outline-warning btn-sm", id := "ys-copy-link")(
                i(cls := "bi bi-clipboard me-1"), I18n.t("yonin.copyLink")
              )
            ),
            div(cls := "mb-3")(
              input(`type` := "text", id := "ys-player-name", cls := "form-control bg-dark text-light border-secondary mx-auto",
                style := "max-width: 250px;",
                placeholder := I18n.t("yonin.namePlaceholder"), maxlength := "20")
            ),
            div(id := "ys-seats", cls := "ys-lobby-seats mb-3"),
            button(cls := "btn btn-success btn-lg", id := "ys-start-btn", style := "display:none;")(
              i(cls := "bi bi-play-fill me-2"),
              I18n.t("yonin.startGame")
            )
          )
        ),

        // ── Game area ──
        div(id := "ys-game-area", style := "display:none;")(
          div(cls := "container-fluid py-2", style := "max-width: 1200px;")(
            div(cls := "row g-3")(
              // Board column
              div(cls := "col-lg-8")(
                // Status bar
                div(id := "ys-status", cls := "text-center mb-2 fs-5"),
                // Player cards
                div(id := "ys-player-cards", cls := "ys-players mb-2"),
                // Board with hands
                div(cls := "ys-wrapper")(
                  div(cls := "ys-board-area")(
                    div(id := "ys-hand-north", cls := "ys-hand ys-hand-north"),
                    div(id := "ys-hand-west", cls := "ys-hand ys-hand-west"),
                    div(id := "ys-board", cls := "ys-board"),
                    div(id := "ys-hand-east", cls := "ys-hand ys-hand-east"),
                    div(id := "ys-hand-south", cls := "ys-hand ys-hand-south")
                  )
                )
              ),
              // Side panel
              div(cls := "col-lg-4")(
                div(cls := "card bg-dark text-light border-secondary")(
                  div(cls := "card-header")(
                    h6(cls := "mb-0")(i(cls := "bi bi-list-ol me-2"), I18n.t("yonin.moveLog"))
                  ),
                  div(cls := "card-body p-2")(
                    div(id := "ys-move-log", cls := "ys-move-log")
                  )
                ),
                div(id := "ys-solo-controls", cls := "mt-2 text-center", style := "display:none;")(
                  a(cls := "btn btn-warning btn-sm me-2", href := "/yonin-shogi/solo")(
                    i(cls := "bi bi-arrow-repeat me-1"), I18n.t("yonin.playAgain")
                  ),
                  a(cls := "btn btn-outline-secondary btn-sm", href := "/yonin-shogi")(
                    i(cls := "bi bi-house me-1"), I18n.t("yonin.backToLobby")
                  )
                ),
                div(id := "ys-copy-controls", cls := "mt-2 text-center")(
                  button(cls := "btn btn-outline-warning btn-sm", id := "ys-copy-link-game",
                    onclick := "document.getElementById('ys-copy-link') && document.getElementById('ys-copy-link').click()")(
                    i(cls := "bi bi-clipboard me-1"), I18n.t("yonin.copyLink")
                  )
                )
              )
            )
          )
        ),

        script(src := "https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"),
        script(raw(s"window.i18n = ${I18n.messagesAsJson(lang)};")),
        script(src := "/js/yonin-shogi.js"),
        script(raw(initScript))
      )
    )
  }

  def renderTutorialPage()(implicit lang: String) = {
    tag("html")(attr("lang") := lang, cls := "dark")(
      Layout.headFrag(I18n.t("yonin.tut.title")),
      body(cls := "wood")(
        Layout.headerFrag,

        div(cls := "container py-4")(
          div(cls := "text-center mb-3")(
            h1(cls := "display-6 fw-bold")(
              i(cls := "bi bi-mortarboard-fill me-3", style := "color: #5bc0de;"),
              I18n.t("yonin.tut.title")
            ),
            p(cls := "text-light-50")(I18n.t("yonin.tut.subtitle"))
          ),

          div(cls := "card bg-dark text-light border-info border-2 mx-auto", style := "max-width: 980px;")(
            div(cls := "card-body")(
              // Step progress dots
              div(id := "yt-dots", cls := "yt-dots mb-3"),

              div(cls := "row g-4 align-items-start")(
                // Board column
                div(cls := "col-lg-6 d-flex justify-content-center")(
                  div(cls := "ys-wrapper")(
                    div(cls := "yt-board-area")(
                      div(id := "yt-board", cls := "ys-board")
                    ),
                    div(id := "yt-hand", cls := "ys-hand ys-hand-south", style := "min-width: 60px;")
                  )
                ),
                // Instruction column
                div(cls := "col-lg-6")(
                  h4(id := "yt-step-title", cls := "mb-2"),
                  p(id := "yt-step-body", cls := "text-light-50"),
                  div(id := "yt-feedback", cls := "yt-feedback mb-3", style := "display:none;"),
                  div(cls := "d-flex gap-2 flex-wrap")(
                    button(id := "yt-restart", cls := "btn btn-outline-secondary")(
                      i(cls := "bi bi-arrow-counterclockwise me-1"), I18n.t("yonin.tut.restart")
                    ),
                    button(id := "yt-next", cls := "btn btn-info")(
                      I18n.t("yonin.tut.next"), i(cls := "bi bi-arrow-right ms-1")
                    )
                  ),
                  // Finish actions (shown on last step)
                  div(id := "yt-finish", cls := "mt-3 d-flex gap-2 flex-wrap", style := "display:none;")(
                    a(cls := "btn btn-warning", href := "/yonin-shogi/solo?bots=3")(
                      i(cls := "bi bi-robot me-1"), I18n.t("yonin.tut.playBots")
                    ),
                    a(cls := "btn btn-outline-warning", href := "/yonin-shogi")(
                      i(cls := "bi bi-people-fill me-1"), I18n.t("yonin.tut.createGame")
                    )
                  )
                )
              )
            )
          )
        ),

        script(src := "https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"),
        script(raw(s"window.i18n = ${I18n.messagesAsJson(lang)};")),
        script(src := "/js/yonin-shogi.js"),
        script(src := "/js/yonin-tutorial.js"),
        script(raw("YoninTutorial.init();"))
      )
    )
  }

  initialize()
}
