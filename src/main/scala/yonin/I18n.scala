package yonin

import scala.io.Source
import scala.util.Try

/**
 * Simple i18n helper that loads translations from JSON files in
 * src/main/resources/i18n/ (en.json, sk.json).
 *
 * Usage in Scala (Scalatags):
 *   implicit val lang: String = I18n.defaultLang  // or from cookie/query
 *   I18n.t("yonin.pageTitle")
 *
 * Usage in JavaScript:
 *   window.i18n["yonin.pageTitle"]   // injected into each page
 */
object I18n {

  val defaultLang = "en"
  val supportedLangs: Set[String] = Set("en", "sk")

  private def loadMessages(lang: String): Map[String, String] = {
    Try {
      val stream = getClass.getResourceAsStream(s"/i18n/$lang.json")
      if (stream == null) Map.empty[String, String]
      else {
        val content = Source.fromInputStream(stream, "UTF-8").mkString
        ujson.read(content).obj.map { case (k, v) => k -> v.str }.toMap
      }
    }.getOrElse(Map.empty[String, String])
  }

  /** All translations keyed by language code. Loaded once at startup. */
  private val translations: Map[String, Map[String, String]] =
    supportedLangs.map(lang => lang -> loadMessages(lang)).toMap

  /** Translate a key; falls back to English, then to the key itself. */
  def t(key: String)(implicit lang: String): String =
    translations.getOrElse(lang, Map.empty).getOrElse(
      key,
      translations.getOrElse(defaultLang, Map.empty).getOrElse(key, key)
    )

  /** Validate lang from cookie/query; return defaultLang if unsupported. */
  def validateLang(lang: String): String =
    if (supportedLangs.contains(lang)) lang else defaultLang

  /** Serialize all messages for a language as a JSON object string for window.i18n. */
  def messagesAsJson(lang: String): String = {
    val msgs = translations.getOrElse(lang, translations.getOrElse(defaultLang, Map.empty))
    val pairs = msgs.map { case (k, v) =>
      val ek = k.replace("\\", "\\\\").replace("\"", "\\\"")
      val ev = v.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "")
      s""""$ek":"$ev""""
    }
    pairs.mkString("{", ",", "}")
  }
}
