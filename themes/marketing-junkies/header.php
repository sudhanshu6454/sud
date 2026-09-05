<?php
/**
 * Site header: date strip, logo, primary nav, search + subscribe, ad band.
 *
 * @package marketing-junkies
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
<a class="screen-reader-text" href="#mj-content"><?php esc_html_e( 'Skip to content', 'marketing-junkies' ); ?></a>

<div class="mj-topstrip"><div class="mj-wrap">
	<span><?php echo esc_html( mj_today() ); ?></span>
	<span><?php echo esc_html( get_theme_mod( 'mj_strip_text', 'marketing · daily' ) ); ?></span>
</div></div>

<header class="mj-header">
	<input type="checkbox" id="mj-menu" class="mj-menu-check" aria-hidden="true">
	<div class="mj-wrap">
		<label for="mj-menu" class="mj-menu-toggle" aria-label="<?php esc_attr_e( 'Menu', 'marketing-junkies' ); ?>"><span></span><span></span></label>
		<a href="<?php echo esc_url( home_url( '/' ) ); ?>" class="mj-logo" aria-label="<?php echo esc_attr( get_bloginfo( 'name' ) ); ?> home">
			<img src="<?php echo esc_url( MJ_URI . '/assets/img/mj-lockup.png' ); ?>" alt="<?php echo esc_attr( get_bloginfo( 'name' ) ); ?>" width="220" height="86" fetchpriority="high">
		</a>
		<nav class="mj-nav" aria-label="<?php esc_attr_e( 'Primary', 'marketing-junkies' ); ?>">
			<?php mj_nav_menu( 'primary', 'mj-nav-list' ); ?>
		</nav>
		<div class="mj-actions">
			<a href="#mj-search" class="btn btn-secondary" data-mj-search><?php esc_html_e( 'Search', 'marketing-junkies' ); ?></a>
			<a href="#newsletter" class="btn btn-primary"><?php esc_html_e( 'Subscribe', 'marketing-junkies' ); ?></a>
		</div>
	</div>
</header>

<div class="mj-search" id="mj-search">
	<form role="search" method="get" action="<?php echo esc_url( home_url( '/' ) ); ?>" class="mj-wrap">
		<label class="screen-reader-text" for="mj-s"><?php esc_html_e( 'Search stories', 'marketing-junkies' ); ?></label>
		<input id="mj-s" class="mj-input" type="search" name="s" placeholder="<?php esc_attr_e( 'Search stories…', 'marketing-junkies' ); ?>" value="<?php echo esc_attr( get_search_query() ); ?>">
		<button type="submit" class="btn btn-primary"><?php esc_html_e( 'Search', 'marketing-junkies' ); ?></button>
	</form>
</div>

<div class="mj-only-desktop"><?php mj_ad_slot( 'leaderboard', 970, 90, 'mj-ad-band' ); ?></div>
<div class="mj-only-mobile"><?php mj_ad_slot( 'mobile_banner', 320, 50, 'mj-ad-band-mobile' ); ?></div>

<div id="mj-content" class="mj-wrap">
