package yonin

import scala.collection.mutable.ArrayBuffer

/**
 * Server-side Yonin Shogi (4-player) rules engine + bot, ported faithfully from
 * the client engine in yonin-shogi.js so the two never disagree about legality,
 * turn order, checkmate or elimination. The client still reconstructs the board
 * by replaying the move list; the server keeps its own authoritative board only
 * to validate turn order, detect checkmate, drive bot seats and score moves (CP).
 */
object ShogiEngine {

  // ── Piece types ───────────────────────────────────────────
  val PAWN = 0; val SILVER = 1; val GOLD = 2; val ROOK = 3; val KING = 4
  val P_PAWN = 5; val P_SILVER = 6; val P_ROOK = 7

  val DEMOTE: Array[Int]       = Array(0, 1, 2, 3, 4, 0, 1, 3)        // promoted → base
  val PROMOTE: Array[Int]      = Array(5, 6, 2, 7, 4, 5, 6, 7)        // base → promoted (gold/king identity)
  val CAN_PROMOTE: Array[Boolean] = Array(true, true, false, true, false, false, false, false)
  // Material values (pawn=1). King is 0 — capturing it never happens via normal play.
  val PIECE_VALUE: Array[Double] = Array(1, 5, 6, 11, 0, 7, 7, 13)

  // Movement vectors for a piece facing UP (player 0 = south).
  private val STEPS: Array[Array[(Int, Int)]] = Array(
    Array((-1, 0)),                                                    // pawn
    Array((-1, -1), (-1, 0), (-1, 1), (1, -1), (1, 1)),               // silver
    Array((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, 0)),       // gold
    Array(),                                                           // rook (slides only)
    Array((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)), // king
    Array((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, 0)),       // +pawn = gold
    Array((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, 0)),       // +silver = gold
    Array((-1, -1), (-1, 1), (1, -1), (1, 1))                         // +rook diagonals
  )
  private val SLIDES: Array[Array[(Int, Int)]] = Array(
    Array(), Array(), Array(),
    Array((-1, 0), (1, 0), (0, -1), (0, 1)),                          // rook
    Array(), Array(), Array(),
    Array((-1, 0), (1, 0), (0, -1), (0, 1))                           // +rook
  )

  // Initial layout: offsets from each king (player 0 facing up), rotated per seat.
  private val SETUP: Array[(Int, Int, Int)] = Array(
    (SILVER, 0, -2), (GOLD, 0, -1), (KING, 0, 0), (GOLD, 0, 1), (SILVER, 0, 2),
    (PAWN, -1, -1), (ROOK, -1, 0), (PAWN, -1, 1), (PAWN, -2, 0)
  )
  private val KING_POS = Array((8, 4), (4, 0), (0, 4), (4, 8))
  private val CENTER = 4

  // ── Model ─────────────────────────────────────────────────
  final class Piece(var ptype: Int, var owner: Int, var dir: Int = -1, var dead: Boolean = false) {
    // Movement direction: normally the owner, but pieces inherited via checkmate
    // keep the eliminated player's facing.
    def direction: Int = if (dir >= 0) dir else owner
    def dup(): Piece = new Piece(ptype, owner, dir, dead)
  }
  type Board = Array[Array[Piece]] // null = empty square

  /** Mutable authoritative game state. hands(player)(pieceType 0..3). */
  final class GameState(
    var board: Board,
    val alive: Array[Boolean],
    val hands: Array[Array[Int]],
    var currentPlayer: Int
  )

  sealed trait Move { def player: Int }
  final case class BoardMove(player: Int, fr: Int, fc: Int, tr: Int, tc: Int, promote: Boolean) extends Move
  final case class DropMove(player: Int, pieceType: Int, tr: Int, tc: Int) extends Move

  // ── Geometry ──────────────────────────────────────────────
  def rotateVec(dr: Int, dc: Int, n: Int): (Int, Int) = {
    var a = dr; var b = dc
    val k = ((n % 4) + 4) % 4
    var i = 0
    while (i < k) { val na = b; val nb = -a; a = na; b = nb; i += 1 }
    (a, b)
  }
  def inBounds(r: Int, c: Int): Boolean = r >= 0 && r < 9 && c >= 0 && c < 9

  private def isDeadZone(player: Int, r: Int, c: Int): Boolean = player match {
    case 0 => r == 0; case 1 => c == 8; case 2 => r == 8; case _ => c == 0
  }
  private def inPromoZone(player: Int, r: Int, c: Int): Boolean = player match {
    case 0 => r <= 2; case 1 => c >= 6; case 2 => r >= 6; case _ => c <= 2
  }

  // ── Board construction ────────────────────────────────────
  def initialBoard(): Board = {
    val b = Array.ofDim[Piece](9, 9)
    var player = 0
    while (player < 4) {
      val (kr, kc) = KING_POS(player)
      var i = 0
      while (i < SETUP.length) {
        val (pt, dr0, dc0) = SETUP(i)
        val (dr, dc) = rotateVec(dr0, dc0, player)
        val r = kr + dr; val c = kc + dc
        if (inBounds(r, c)) b(r)(c) = new Piece(pt, player)
        i += 1
      }
      player += 1
    }
    b
  }

  def initialState(alive: Array[Boolean], firstPlayer: Int): GameState =
    new GameState(initialBoard(), alive.clone(), Array.fill(4, 4)(0), firstPlayer)

  def cloneBoard(b: Board): Board = {
    val nb = Array.ofDim[Piece](9, 9)
    var r = 0
    while (r < 9) { var c = 0; while (c < 9) { val p = b(r)(c); if (p != null) nb(r)(c) = p.dup(); c += 1 }; r += 1 }
    nb
  }
  private def cloneState(st: GameState): GameState =
    new GameState(cloneBoard(st.board), st.alive.clone(), st.hands.map(_.clone()), st.currentPlayer)

  // ── Move generation ───────────────────────────────────────
  def reachable(b: Board, alive: Array[Boolean], r: Int, c: Int): ArrayBuffer[(Int, Int)] = {
    val out = new ArrayBuffer[(Int, Int)]()
    val p = b(r)(c)
    if (p == null) return out
    val n = p.direction
    val steps = STEPS(p.ptype)
    var i = 0
    while (i < steps.length) {
      val (dr0, dc0) = steps(i)
      val (dr, dc) = rotateVec(dr0, dc0, n)
      val nr = r + dr; val nc = c + dc
      if (inBounds(nr, nc)) {
        val t = b(nr)(nc)
        if (t == null) out += ((nr, nc))
        else if (t.owner != p.owner && !(t.ptype == KING && !alive(t.owner))) out += ((nr, nc))
      }
      i += 1
    }
    val slides = SLIDES(p.ptype)
    i = 0
    while (i < slides.length) {
      val (dr0, dc0) = slides(i)
      val (dr, dc) = rotateVec(dr0, dc0, n)
      var nr = r + dr; var nc = c + dc
      var stop = false
      while (!stop && inBounds(nr, nc)) {
        val t = b(nr)(nc)
        if (t != null) {
          if (t.owner != p.owner && !(t.ptype == KING && !alive(t.owner))) out += ((nr, nc))
          stop = true
        } else { out += ((nr, nc)); nr += dr; nc += dc }
      }
      i += 1
    }
    out
  }

  private def findKing(b: Board, player: Int): (Int, Int) = {
    var r = 0
    while (r < 9) { var c = 0; while (c < 9) { val p = b(r)(c); if (p != null && p.ptype == KING && p.owner == player) return (r, c); c += 1 }; r += 1 }
    (-1, -1)
  }

  private def isThreatened(b: Board, alive: Array[Boolean], r: Int, c: Int, by: Int => Boolean): Boolean = {
    var pr = 0
    while (pr < 9) {
      var pc = 0
      while (pc < 9) {
        val p = b(pr)(pc)
        if (p != null && by(p.owner) && alive(p.owner)) {
          val reach = reachable(b, alive, pr, pc)
          var i = 0
          while (i < reach.length) { val (rr, rc) = reach(i); if (rr == r && rc == c) return true; i += 1 }
        }
        pc += 1
      }
      pr += 1
    }
    false
  }

  def isInCheck(b: Board, alive: Array[Boolean], player: Int): Boolean = {
    val (kr, kc) = findKing(b, player)
    if (kr < 0) return false
    isThreatened(b, alive, kr, kc, o => o != player && alive(o))
  }

  private def simulateMove(b: Board, fr: Int, fc: Int, tr: Int, tc: Int): Board = {
    val nb = cloneBoard(b); nb(tr)(tc) = nb(fr)(fc); nb(fr)(fc) = null; nb
  }

  def validMoves(b: Board, alive: Array[Boolean], r: Int, c: Int, player: Int): ArrayBuffer[(Int, Int)] = {
    val out = new ArrayBuffer[(Int, Int)]()
    val piece = b(r)(c)
    if (piece == null || piece.owner != player) return out
    val reach = reachable(b, alive, r, c)
    var i = 0
    while (i < reach.length) {
      val (tr, tc) = reach(i)
      if (!isInCheck(simulateMove(b, r, c, tr, tc), alive, player)) out += ((tr, tc))
      i += 1
    }
    out
  }

  private def hasNifu(b: Board, player: Int, r: Int, c: Int): Boolean = {
    if (player == 0 || player == 2) {
      var rr = 0; while (rr < 9) { val p = b(rr)(c); if (p != null && p.ptype == PAWN && p.owner == player) return true; rr += 1 }
    } else {
      var cc = 0; while (cc < 9) { val p = b(r)(cc); if (p != null && p.ptype == PAWN && p.owner == player) return true; cc += 1 }
    }
    false
  }

  def droppableSquares(b: Board, alive: Array[Boolean], hands: Array[Array[Int]], pieceType: Int, player: Int): ArrayBuffer[(Int, Int)] = {
    val out = new ArrayBuffer[(Int, Int)]()
    var r = 0
    while (r < 9) {
      var c = 0
      while (c < 9) {
        if (b(r)(c) == null &&
            !(pieceType == PAWN && isDeadZone(player, r, c)) &&
            !(pieceType == PAWN && hasNifu(b, player, r, c))) {
          val sim = cloneBoard(b)
          sim(r)(c) = new Piece(pieceType, player)
          if (!isInCheck(sim, alive, player)) {
            if (pieceType == PAWN) {
              // Uchifuzume: a pawn drop may not deliver immediate checkmate.
              var mates = false
              var e = 0
              while (e < 4 && !mates) { if (e != player && alive(e) && isCheckmated(sim, alive, hands, e)) mates = true; e += 1 }
              if (!mates) out += ((r, c))
            } else out += ((r, c))
          }
        }
        c += 1
      }
      r += 1
    }
    out
  }

  def isCheckmated(b: Board, alive: Array[Boolean], hands: Array[Array[Int]], player: Int): Boolean = {
    if (!alive(player)) return false
    if (!isInCheck(b, alive, player)) return false
    var r = 0
    while (r < 9) {
      var c = 0
      while (c < 9) {
        val p = b(r)(c)
        if (p != null && p.owner == player && validMoves(b, alive, r, c, player).nonEmpty) return false
        c += 1
      }
      r += 1
    }
    var pt = 0
    while (pt < 4) { if (hands(player)(pt) > 0 && droppableSquares(b, alive, hands, pt, player).nonEmpty) return false; pt += 1 }
    true
  }

  // ── Applying moves ────────────────────────────────────────
  /** Apply a move (or drop) to the state and resolve any resulting checkmates. */
  def applyMove(st: GameState, move: Move): Unit = {
    move match {
      case BoardMove(player, fr, fc, tr, tc, promote) =>
        val captured = st.board(tr)(tc)
        if (captured != null) {
          val bt = DEMOTE(captured.ptype)
          if (bt != KING) st.hands(player)(bt) += 1
        }
        st.board(tr)(tc) = st.board(fr)(fc)
        st.board(fr)(fc) = null
        if (promote) {
          val pt = st.board(tr)(tc).ptype
          if (CAN_PROMOTE(pt)) st.board(tr)(tc).ptype = PROMOTE(pt)
        }
        handleCheckmates(st, player)
      case DropMove(player, pieceType, tr, tc) =>
        st.board(tr)(tc) = new Piece(pieceType, player)
        st.hands(player)(pieceType) -= 1
        handleCheckmates(st, player)
    }
  }

  private def handleCheckmates(st: GameState, mover: Int): Unit = {
    var i = 0
    while (i < 4) {
      if (i != mover && st.alive(i) && isCheckmated(st.board, st.alive, st.hands, i)) eliminate(st, i, mover)
      i += 1
    }
  }

  private def eliminate(st: GameState, loser: Int, winner: Int): Unit = {
    st.alive(loser) = false
    var r = 0
    while (r < 9) {
      var c = 0
      while (c < 9) {
        val p = st.board(r)(c)
        if (p != null && p.owner == loser) {
          if (p.ptype == KING) p.dead = true
          else { if (p.dir < 0) p.dir = p.owner; p.owner = winner } // keep original facing (yonin rule)
        }
        c += 1
      }
      r += 1
    }
    var pt = 0
    while (pt < 4) { st.hands(winner)(pt) += st.hands(loser)(pt); st.hands(loser)(pt) = 0; pt += 1 }
  }

  /** Yonin turn order: a checked opponent moves next (clockwise-first if several);
   *  otherwise play passes to the next living player clockwise. */
  def advanceTurn(st: GameState): Unit = {
    var step = 1
    while (step <= 4) {
      val cand = (st.currentPlayer + step) % 4
      if (st.alive(cand) && isInCheck(st.board, st.alive, cand)) { st.currentPlayer = cand; return }
      step += 1
    }
    var next = (st.currentPlayer + 1) % 4
    var i = 0
    while (i < 4) { if (st.alive(next)) { st.currentPlayer = next; return }; next = (next + 1) % 4; i += 1 }
  }

  def aliveCount(st: GameState): Int = st.alive.count(identity)

  // ── Evaluation ────────────────────────────────────────────
  private def material(b: Board, player: Int): Double = {
    var s = 0.0
    var r = 0
    while (r < 9) { var c = 0; while (c < 9) { val p = b(r)(c); if (p != null && p.owner == player) s += PIECE_VALUE(p.ptype); c += 1 }; r += 1 }
    s
  }

  // ── Bot ───────────────────────────────────────────────────
  // `positional` ranks by the player's own material on the resulting board (a
  // depth-0 slice of the eval vector); `paranoid` subtracts the opponents' best
  // capture reply (1-ply "assume they gang up on me") so the bot stops hanging.
  private case class Level(refine: Int, window: Double, blunder: Double, positional: Boolean, paranoid: Boolean)
  private val LEVELS = Map(
    "easy"   -> Level(4, 2.5, 0.30, false, false),
    "medium" -> Level(14, 0.6, 0.0, true, true),
    "hard"   -> Level(28, 0.05, 0.0, true, true)
  )

  /** Board resulting from applying a move/drop to a copy of `b` (promotion handled). */
  private def boardAfter(b: Board, move: Move): Board = {
    val nb = cloneBoard(b)
    move match {
      case BoardMove(_, fr, fc, tr, tc, promote) =>
        nb(tr)(tc) = nb(fr)(fc); nb(fr)(fc) = null
        if (promote) { val pt = nb(tr)(tc).ptype; if (CAN_PROMOTE(pt)) nb(tr)(tc).ptype = PROMOTE(pt) }
      case DropMove(p, pt, tr, tc) => nb(tr)(tc) = new Piece(pt, p)
    }
    nb
  }

  private def ownMobility(b: Board, alive: Array[Boolean], player: Int): Double = {
    var n = 0.0; var r = 0
    while (r < 9) { var c = 0; while (c < 9) { val p = b(r)(c); if (p != null && p.owner == player) n += reachable(b, alive, r, c).length; c += 1 }; r += 1 }
    n
  }

  // Most material an opponent can win on `b` via a single capture (net of the
  // cheapest defender) — the practical core of a 1-ply paranoid search.
  private def worstCaptureLoss(b: Board, alive: Array[Boolean], player: Int): Double = {
    var worst = 0.0; var r = 0
    while (r < 9) {
      var c = 0
      while (c < 9) {
        val p = b(r)(c)
        if (p != null && p.owner == player && p.ptype != KING) {
          val (att, minAtk, def0) = attackInfo(b, alive, r, c, player)
          if (att) { val v = PIECE_VALUE(p.ptype); val loss = if (def0) math.max(0.0, v - minAtk) else v; if (loss > worst) worst = loss }
        }
        c += 1
      }
      r += 1
    }
    worst
  }

  // Positional base score: own material on the resulting board + mild central pull.
  private def positionalBase(st: GameState, move: Move, rnd: scala.util.Random): Double = {
    val b = boardAfter(st.board, move)
    var s = material(b, move.player) + rnd.nextDouble() * 0.3
    val (tr, tc) = move match { case BoardMove(_, _, _, r, c, _) => (r, c); case DropMove(_, _, r, c) => (r, c) }
    s -= (math.abs(tr - CENTER) + math.abs(tc - CENTER)) * 0.03
    if (move.isInstanceOf[DropMove]) s -= 0.25
    s
  }

  private def baseScore(cfg: Level, st: GameState, move: Move, rnd: scala.util.Random): Double =
    if (cfg.positional) positionalBase(st, move, rnd) else staticScore(st, move, rnd)

  private def canPromoteHere(piece: Piece, fr: Int, fc: Int, tr: Int, tc: Int): Boolean = {
    if (!CAN_PROMOTE(piece.ptype)) return false
    val d = piece.direction
    inPromoZone(d, fr, fc) || inPromoZone(d, tr, tc)
  }

  // Cheapest enemy attacker of (tr,tc), and whether any own piece defends it.
  private def attackInfo(b: Board, alive: Array[Boolean], tr: Int, tc: Int, player: Int): (Boolean, Double, Boolean) = {
    var attacked = false; var minAtk = Double.MaxValue; var defended = false
    var r = 0
    while (r < 9) {
      var c = 0
      while (c < 9) {
        val p = b(r)(c)
        if (p != null && alive(p.owner) && !(r == tr && c == tc)) {
          val reach = reachable(b, alive, r, c)
          var hit = false; var i = 0
          while (i < reach.length && !hit) { val (rr, rc) = reach(i); if (rr == tr && rc == tc) hit = true; i += 1 }
          if (hit) {
            if (p.owner == player) defended = true
            else { attacked = true; val v = PIECE_VALUE(p.ptype); if (v < minAtk) minAtk = v }
          }
        }
        c += 1
      }
      r += 1
    }
    (attacked, if (minAtk == Double.MaxValue) 0.0 else minAtk, defended)
  }

  // Static score with a light static-exchange check so the bot stops hanging pieces.
  private def staticScore(st: GameState, move: Move, rnd: scala.util.Random): Double = {
    var score = rnd.nextDouble() * 0.3
    move match {
      case BoardMove(player, fr, fc, tr, tc, promote) =>
        val captured = st.board(tr)(tc)
        if (captured != null && captured.owner != player && captured.ptype != KING) score += PIECE_VALUE(captured.ptype)
        val sim = cloneBoard(st.board)
        sim(tr)(tc) = sim(fr)(fc); sim(fr)(fc) = null
        var movedVal = PIECE_VALUE(sim(tr)(tc).ptype)
        if (promote && CAN_PROMOTE(sim(tr)(tc).ptype)) { sim(tr)(tc).ptype = PROMOTE(sim(tr)(tc).ptype); movedVal = PIECE_VALUE(sim(tr)(tc).ptype); score += 0.7 }
        val (att, minAtk, def0) = attackInfo(sim, st.alive, tr, tc, player)
        if (att) score -= (if (def0) math.max(0.0, movedVal - minAtk) else movedVal)
        score -= (math.abs(tr - CENTER) + math.abs(tc - CENTER)) * 0.03
      case DropMove(player, pieceType, tr, tc) =>
        val sim = cloneBoard(st.board)
        sim(tr)(tc) = new Piece(pieceType, player)
        val (att, minAtk, def0) = attackInfo(sim, st.alive, tr, tc, player)
        if (att) score -= (if (def0) math.max(0.0, PIECE_VALUE(pieceType) - minAtk) else PIECE_VALUE(pieceType))
        score -= 0.25
    }
    score
  }

  // Reward checks and (especially) checkmates the move delivers.
  private def threatBonus(st: GameState, move: Move): Double = {
    val sim = cloneState(st)
    applyMoveNoMate(sim, move)
    var s = 0.0
    var e = 0
    while (e < 4) {
      if (e != move.player && st.alive(e)) {
        if (isCheckmated(sim.board, sim.alive, sim.hands, e)) {
          s += 60
          var r = 0
          while (r < 9) { var c = 0; while (c < 9) { val p = sim.board(r)(c); if (p != null && p.owner == e && p.ptype != KING) s += PIECE_VALUE(p.ptype) * 0.4; c += 1 }; r += 1 }
        } else if (isInCheck(sim.board, sim.alive, e)) s += 1.5
      }
      e += 1
    }
    s
  }

  // Apply move to board/hands WITHOUT resolving checkmates (for threat probing).
  private def applyMoveNoMate(st: GameState, move: Move): Unit = move match {
    case BoardMove(player, fr, fc, tr, tc, promote) =>
      val captured = st.board(tr)(tc)
      if (captured != null) { val bt = DEMOTE(captured.ptype); if (bt != KING) st.hands(player)(bt) += 1 }
      st.board(tr)(tc) = st.board(fr)(fc); st.board(fr)(fc) = null
      if (promote) { val pt = st.board(tr)(tc).ptype; if (CAN_PROMOTE(pt)) st.board(tr)(tc).ptype = PROMOTE(pt) }
    case DropMove(player, pieceType, tr, tc) =>
      st.board(tr)(tc) = new Piece(pieceType, player); st.hands(player)(pieceType) -= 1
  }

  /** Choose a bot move for `player`, or None if the seat has no legal move.
   *  `seed` varies play between turns. */
  def chooseBotMove(st: GameState, player: Int, level: String, seed: Int): Option[Move] = {
    val cfg = LEVELS.getOrElse(level, LEVELS("medium"))
    val rnd = new scala.util.Random(seed.toLong * 1000003L + player)
    val cands = new ArrayBuffer[(Move, Double)]()

    var r = 0
    while (r < 9) {
      var c = 0
      while (c < 9) {
        val piece = st.board(r)(c)
        if (piece != null && piece.owner == player) {
          val moves = validMoves(st.board, st.alive, r, c, player)
          var i = 0
          while (i < moves.length) {
            val (tr, tc) = moves(i)
            val promote = canPromoteHere(piece, r, c, tr, tc)
            val m = BoardMove(player, r, c, tr, tc, promote)
            cands += ((m, baseScore(cfg, st, m, rnd)))
            i += 1
          }
        }
        c += 1
      }
      r += 1
    }
    var pt = 0
    while (pt < 4) {
      if (st.hands(player)(pt) > 0) {
        val sq = droppableSquares(st.board, st.alive, st.hands, pt, player)
        var i = 0
        while (i < sq.length) { val (tr, tc) = sq(i); val m = DropMove(player, pt, tr, tc); cands += ((m, baseScore(cfg, st, m, rnd))); i += 1 }
        pt += 1
      } else pt += 1
    }

    if (cands.isEmpty) return None

    val chosen: Move =
      if (cfg.blunder > 0 && rnd.nextDouble() < cfg.blunder) {
        cands(rnd.nextInt(cands.length))._1
      } else {
        var scored = cands.sortBy(-_._2)
        val refine = math.min(cfg.refine, scored.length)
        val refined = new ArrayBuffer[(Move, Double)]()
        var i = 0
        while (i < scored.length) {
          val (m, s) = scored(i)
          var bonus = 0.0
          if (i < refine) {
            bonus += threatBonus(st, m)
            if (cfg.positional) {
              val after = boardAfter(st.board, m)
              bonus += ownMobility(after, st.alive, m.player) * 0.03
              if (cfg.paranoid) bonus -= worstCaptureLoss(after, st.alive, m.player)
            }
          }
          refined += ((m, s + bonus))
          i += 1
        }
        scored = refined.sortBy(-_._2)
        val top = scored.head._2
        val pool = scored.filter(_._2 >= top - cfg.window)
        pool(rnd.nextInt(pool.length))._1
      }

    Some(chosen)
  }

  // ── JSON (matches the client move format) ─────────────────
  def parseMove(data: ujson.Value, seat: Int): Move = {
    data("type").str match {
      case "move" =>
        val from = data("from").arr; val to = data("to").arr
        BoardMove(seat, from(0).num.toInt, from(1).num.toInt, to(0).num.toInt, to(1).num.toInt,
          data.obj.get("promote").exists(_.bool))
      case _ =>
        val to = data("to").arr
        DropMove(seat, data("pieceType").num.toInt, to(0).num.toInt, to(1).num.toInt)
    }
  }

  def moveToJson(move: Move, botLevel: Option[String]): ujson.Obj = {
    val base: ujson.Obj = move match {
      case BoardMove(p, fr, fc, tr, tc, promote) =>
        ujson.Obj("type" -> "move", "player" -> p, "from" -> ujson.Arr(fr, fc), "to" -> ujson.Arr(tr, tc), "promote" -> promote)
      case DropMove(p, pt, tr, tc) =>
        ujson.Obj("type" -> "drop", "player" -> p, "pieceType" -> pt, "to" -> ujson.Arr(tr, tc))
    }
    botLevel.foreach(l => base("bot") = l)
    base
  }
}
