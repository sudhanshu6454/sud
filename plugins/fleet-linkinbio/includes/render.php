<?php
/**
 * Draw the bio page. Pure: takes arrays in, returns HTML out, so it can be previewed without
 * WordPress (see tests/preview.php) and so every string passes through the escapers exactly once.
 *
 * $brand: a row from brands.php.  $site: name, tagline, home, logo_url, generated (ISO time).
 * $posts: newest first, each: url, title, category, image (may be ''), when ("2 h ago").
 */
if ( ! defined( 'ABSPATH' ) && ! defined( 'FLEET_BIO_PREVIEW' ) ) { exit; }

function fleet_bio_rail_css( string $style, string $accent ): string {
	switch ( $style ) {
		case 'double':
			return "background: linear-gradient($accent, $accent) 0 0/100% 4px no-repeat, linear-gradient($accent, $accent) 0 8px/100% 3px no-repeat; height: 11px;";
		case 'inset':
			return "background: $accent; height: 4px; margin: 0 20px;";
		case 'bars':
			return "background: repeating-linear-gradient(90deg, $accent 0 44px, transparent 44px 60px); height: 5px; opacity: .95;";
		default:
			return "background: $accent; height: 5px;";
	}
}

function fleet_bio_render( array $brand, array $site, array $posts ): string {
	$p = $brand['primary']; $a = $brand['accent']; $t = $brand['text'];
	$font = $brand['font'];
	$ig   = $brand['instagram'] ? 'https://www.instagram.com/' . rawurlencode( $brand['instagram'] ) . '/' : '';
	$fb   = $brand['facebook'];
	$rail = fleet_bio_rail_css( $brand['rail'], $a );
	$name = $site['name'] ?: $brand['name'];
	$tag  = $site['tagline'] ?: $brand['tagline'];

	ob_start();
	?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title><?php echo esc_html( $name ); ?> · Latest stories</title>
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="<?php echo esc_attr( $p ); ?>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=<?php echo esc_attr( $brand['font_query'] ); ?>&display=swap">
<style>
:root { --p: <?php echo esc_html( $p ); ?>; --a: <?php echo esc_html( $a ); ?>; --t: <?php echo esc_html( $t ); ?>; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html { -webkit-text-size-adjust: 100%; }
body { background: var(--p); color: var(--t); font-family: "<?php echo esc_html( $font ); ?>", system-ui, -apple-system, "Segoe UI", sans-serif; min-height: 100dvh;
  background-image: linear-gradient(180deg, color-mix(in srgb, var(--p) 100%, #000 0%) 0%, color-mix(in srgb, var(--p) 55%, #000 45%) 100%); }
a { color: inherit; text-decoration: none; }
.wrap { max-width: 520px; margin: 0 auto; padding: 28px 16px calc(40px + env(safe-area-inset-bottom)); }
.rail { <?php echo $rail; ?> margin-bottom: 26px; }
.head { text-align: center; padding: 6px 0 18px; }
.head img { height: 56px; max-width: 72%; object-fit: contain; }
.head .word { font-weight: 700; font-size: 28px; letter-spacing: -.01em; }
.head p { margin-top: 10px; font-size: 15px; line-height: 1.4; opacity: .78; }
.btns { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin: 8px 0 30px; }
.btn { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 14px 10px; border-radius: 14px; font-weight: 600; font-size: 14px;
  background: color-mix(in srgb, var(--t) 8%, transparent); border: 1px solid color-mix(in srgb, var(--t) 14%, transparent); }
.btn.site { background: var(--a); color: <?php echo esc_html( fleet_bio_ink_on( $a ) ); ?>; border-color: var(--a); }
.btn svg { width: 18px; height: 18px; fill: currentColor; flex: none; }
h2 { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; opacity: .72; margin: 0 0 14px; display: flex; align-items: center; gap: 12px; }
h2::after { content: ""; flex: 1; height: 1px; background: color-mix(in srgb, var(--t) 18%, transparent); }
.list { display: grid; gap: 12px; }
.card { display: grid; grid-template-columns: 96px 1fr; gap: 14px; align-items: center; padding: 12px; border-radius: 16px;
  background: color-mix(in srgb, var(--t) 6%, transparent); border: 1px solid color-mix(in srgb, var(--t) 10%, transparent); transition: transform .12s ease, background .12s ease; }
.card:active { transform: scale(.985); }
.card:hover { background: color-mix(in srgb, var(--t) 10%, transparent); }
.card .thumb { width: 96px; height: 96px; border-radius: 10px; object-fit: cover; background: color-mix(in srgb, var(--a) 30%, var(--p)); display: block; }
.card .k { font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--a); margin-bottom: 6px; }
.card .h { font-weight: 600; font-size: 16px; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.card .m { margin-top: 7px; font-size: 12px; opacity: .62; }
.card.lead { grid-template-columns: 1fr; padding: 0; overflow: hidden; }
.card.lead .thumb { width: 100%; height: 220px; border-radius: 0; }
.card.lead .body { padding: 16px 16px 18px; }
.card.lead .h { font-size: 21px; font-weight: 700; -webkit-line-clamp: 3; }
.card.lead .k::before { content: "New · "; }
.foot { margin-top: 34px; text-align: center; font-size: 12px; opacity: .5; }
.foot a { border-bottom: 1px solid color-mix(in srgb, var(--t) 30%, transparent); }
</style>
</head>
<body>
<div class="wrap">
  <div class="rail" aria-hidden="true"></div>
  <header class="head">
    <a href="<?php echo esc_url( $site['home'] ); ?>" aria-label="<?php echo esc_attr( $name ); ?>">
      <?php if ( $site['logo_url'] ) : ?>
        <img src="<?php echo esc_url( $site['logo_url'] ); ?>" alt="<?php echo esc_attr( $name ); ?>">
      <?php else : ?>
        <div class="word"><?php echo esc_html( $name ); ?></div>
      <?php endif; ?>
    </a>
    <?php if ( $tag ) : ?><p><?php echo esc_html( $tag ); ?></p><?php endif; ?>
  </header>

  <nav class="btns" aria-label="Links">
    <a class="btn site" href="<?php echo esc_url( $site['home'] ); ?>"><svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm7.9 9h-3.4a15.6 15.6 0 0 0-1.3-6A8 8 0 0 1 19.9 11ZM12 4c1.1 1.3 2.2 3.8 2.5 7h-5c.3-3.2 1.4-5.7 2.5-7ZM8.8 5a15.6 15.6 0 0 0-1.3 6H4.1A8 8 0 0 1 8.8 5ZM4.1 13h3.4c.1 2.3.6 4.4 1.3 6A8 8 0 0 1 4.1 13ZM12 20c-1.1-1.3-2.2-3.8-2.5-7h5c-.3 3.2-1.4 5.7-2.5 7Zm3.2-1a15.6 15.6 0 0 0 1.3-6h3.4a8 8 0 0 1-4.7 6Z"/></svg>Website</a>
    <?php if ( $ig ) : ?><a class="btn" href="<?php echo esc_url( $ig ); ?>" rel="me noopener"><svg viewBox="0 0 24 24"><path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7Zm5 3.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm5.3-3.3a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2Z"/></svg>Instagram</a><?php endif; ?>
    <?php if ( $fb ) : ?><a class="btn" href="<?php echo esc_url( $fb ); ?>" rel="me noopener"><svg viewBox="0 0 24 24"><path d="M13.5 22v-8h2.7l.4-3.2h-3.1V8.8c0-.9.3-1.6 1.6-1.6h1.7V4.3c-.3 0-1.3-.1-2.5-.1-2.5 0-4.1 1.5-4.1 4.2v2.4H7.4V14h2.8v8h3.3Z"/></svg>Facebook</a><?php endif; ?>
  </nav>

  <h2>Latest stories</h2>
  <div class="list">
    <?php foreach ( $posts as $i => $post ) : ?>
    <a class="card<?php echo 0 === $i ? ' lead' : ''; ?>" href="<?php echo esc_url( $post['url'] ); ?>">
      <?php if ( $post['image'] ) : ?>
        <img class="thumb" src="<?php echo esc_url( $post['image'] ); ?>" alt="" loading="<?php echo 0 === $i ? 'eager' : 'lazy'; ?>">
      <?php else : ?>
        <span class="thumb" aria-hidden="true"></span>
      <?php endif; ?>
      <span class="body">
        <span class="k"><?php echo esc_html( $post['category'] ); ?></span>
        <span class="h"><?php echo esc_html( $post['title'] ); ?></span>
        <span class="m"><?php echo esc_html( $post['when'] ); ?></span>
      </span>
    </a>
    <?php endforeach; ?>
    <?php if ( ! $posts ) : ?><p style="opacity:.7">No stories yet. Check back soon.</p><?php endif; ?>
  </div>

  <footer class="foot"><a href="<?php echo esc_url( $site['home'] ); ?>"><?php echo esc_html( preg_replace( '#^https?://#', '', rtrim( $site['home'], '/' ) ) ); ?></a> · every story, all day</footer>
</div>
</body>
</html>
	<?php
	return (string) ob_get_clean();
}

/** Black or white type on the accent, whichever contrasts more (same rule the share cards use). */
function fleet_bio_ink_on( string $hex ): string {
	$hex = ltrim( $hex, '#' );
	if ( 3 === strlen( $hex ) ) { $hex = preg_replace( '/(.)/', '$1$1', $hex ); }
	$r = hexdec( substr( $hex, 0, 2 ) ); $g = hexdec( substr( $hex, 2, 2 ) ); $b = hexdec( substr( $hex, 4, 2 ) );
	$luma = 0.2126 * $r + 0.7152 * $g + 0.0722 * $b;
	return $luma > 150 ? '#0c0c0c' : '#ffffff';
}
