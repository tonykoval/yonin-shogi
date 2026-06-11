package yonin

import scalatags.Text.all._
import scalatags.Text.tags2.{title => titleTag}

/**
 * Shared page chrome for the standalone Yonin Shogi app: the document <head>
 * and a minimal top navbar. Replaces the parent project's Components.renderHeader
 * (which carried auth, theme settings and links to routes that do not exist here).
 */
object Layout {

  /** Common <head>: meta, Bootstrap + icons CDN, and the app's own stylesheets. */
  def headFrag(pageTitle: String): Frag =
    head(
      meta(charset := "utf-8"),
      meta(name := "viewport", attr("content") := "width=device-width, initial-scale=1"),
      titleTag(pageTitle),
      link(rel := "stylesheet", href := "https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css"),
      link(rel := "stylesheet", href := "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css"),
      link(rel := "stylesheet", href := "/assets/css/app.css"),
      link(rel := "stylesheet", href := "/assets/css/yonin-shogi.css")
    )

  /** Minimal navbar: brand + Tutorial / Solo / Online links + language toggle. */
  def headerFrag(implicit lang: String): Frag =
    tag("nav")(cls := "navbar navbar-expand-lg navbar-dark border-bottom border-secondary",
      style := "background: rgba(0,0,0,.35);")(
      div(cls := "container-fluid")(
        a(cls := "navbar-brand fw-bold", href := "/")(
          i(cls := "bi bi-people-fill me-2", style := "color: #e8a317;"),
          I18n.t("app.brand")
        ),
        button(cls := "navbar-toggler", tpe := "button",
          attr("data-bs-toggle") := "collapse", attr("data-bs-target") := "#ys-nav",
          attr("aria-controls") := "ys-nav", attr("aria-expanded") := "false",
          attr("aria-label") := "Toggle navigation")(
          span(cls := "navbar-toggler-icon")
        ),
        div(cls := "collapse navbar-collapse", id := "ys-nav")(
          ul(cls := "navbar-nav me-auto mb-2 mb-lg-0")(
            li(cls := "nav-item")(
              a(cls := "nav-link", href := "/yonin-shogi/tutorial")(
                i(cls := "bi bi-mortarboard-fill me-1"), I18n.t("nav.tutorial"))
            ),
            li(cls := "nav-item")(
              a(cls := "nav-link", href := "/yonin-shogi/solo?bots=3")(
                i(cls := "bi bi-robot me-1"), I18n.t("nav.solo"))
            ),
            li(cls := "nav-item")(
              a(cls := "nav-link", href := "/yonin-shogi")(
                i(cls := "bi bi-people-fill me-1"), I18n.t("nav.online"))
            )
          ),
          div(cls := "dropdown")(
            button(cls := "btn btn-sm btn-outline-light dropdown-toggle", tpe := "button",
              attr("data-bs-toggle") := "dropdown", attr("aria-expanded") := "false")(
              i(cls := "bi bi-translate me-1"), lang.toUpperCase
            ),
            ul(cls := "dropdown-menu dropdown-menu-end dropdown-menu-dark")(
              li(a(cls := "dropdown-item", href := "/lang/en")("English")),
              li(a(cls := "dropdown-item", href := "/lang/sk")("Slovenčina"))
            )
          )
        )
      )
    )
}
