<?php
/**
 * Site header: nav, search trigger, mobile menu, subscribe CTA.
 *
 * @package marketing-mentalist
 */
?><!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo( 'charset' ); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1">
<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>
<a class="screen-reader-text" href="#mm-content">Skip to content</a>

<header class="mm-header" id="mm-header">
	<div class="mm-wrap">
		<button class="mm-menu-toggle" id="mm-menu-toggle" aria-label="Menu" aria-expanded="false"><span></span><span></span></button>
		<a href="<?php echo esc_url( home_url( '/' ) ); ?>" class="mm-brand">
			<img src="<?php echo esc_url( MM_URI . '/assets/img/mark.png' ); ?>" alt="" width="34" height="34" fetchpriority="high">
			<span><?php bloginfo( 'name' ); ?></span>
		</a>
		<nav class="mm-nav" aria-label="Primary"><?php mm_nav_menu( 'primary', '' ); ?></nav>
		<div class="mm-header-actions">
			<button class="mm-search-trigger" id="mm-search-trigger" aria-label="Search">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>
				<span class="mm-only-desktop">Search</span>
			</button>
			<a href="#newsletter" class="mm-only-desktop">The Brand Briefing</a>
			<a href="<?php echo esc_url( mm_page_link( 'advertise' ) ?: home_url( '/advertise/' ) ); ?>" class="mm-btn mm-btn-primary" style="height:40px;padding:0 18px;font-size:13px">Get Featured <span aria-hidden="true">→</span></a>
		</div>
	</div>
</header>

<div class="mm-search-overlay" id="mm-search-overlay">
	<div class="mm-search-overlay-head mm-wrap">
		<span class="mm-brand"><img src="<?php echo esc_url( MM_URI . '/assets/img/mark.png' ); ?>" alt="" width="28" height="28"><?php bloginfo( 'name' ); ?></span>
		<button class="mm-btn-icon" id="mm-search-close" aria-label="Close search">✕</button>
	</div>
	<div class="mm-search-overlay-body">
		<span class="mm-kicker">Campaign archive</span>
		<form role="search" method="get" action="<?php echo esc_url( home_url( '/' ) ); ?>">
			<label for="mm-s" class="mm-h1" style="cursor:text;display:block">What are you trying to decode?</label>
			<div class="mm-search-field">
				<input id="mm-s" type="search" name="s" placeholder="Search campaigns, brands, agencies or ideas…" autocomplete="off">
				<button type="submit" aria-label="Search">→</button>
			</div>
		</form>
		<div class="mm-popular">
			<span class="mm-meta" style="margin-right:8px">Popular</span>
			<?php foreach ( array( 'Funny', 'Emotional', 'AI', 'IPL', 'Celebrity', 'OOH', 'Gen Z', 'Luxury', 'Moment marketing' ) as $s ) : ?>
				<a class="mm-tag" href="<?php echo esc_url( add_query_arg( 's', rawurlencode( $s ), home_url( '/' ) ) ); ?>"><?php echo esc_html( $s ); ?></a>
			<?php endforeach; ?>
		</div>
	</div>
</div>

<div class="mm-mobile-menu" id="mm-mobile-menu">
	<div class="mm-mobile-menu-head">
		<button id="mm-menu-close" aria-label="Close menu">✕</button>
	</div>
	<nav aria-label="Mobile">
		<?php mm_nav_menu( 'mobile', 'mm-mobile-menu-list' ); ?>
	</nav>
	<div class="mm-mobile-menu-social">
		<?php foreach ( mm_social_links() as $label => $url ) : ?>
			<a href="<?php echo esc_url( $url ); ?>" rel="me noopener" target="_blank"><?php echo esc_html( $label ); ?></a>
		<?php endforeach; ?>
	</div>
</div>

<main id="mm-content">
