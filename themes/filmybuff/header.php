<!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo( 'charset' ); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#201e1d">
<?php if ( ! has_site_icon() ) : ?><link rel="icon" type="image/png" href="<?php echo esc_url( get_template_directory_uri() . '/assets/img/favicon.png' ); ?>" sizes="32x32"><?php endif; ?>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>
<div class="site">
<?php if ( get_theme_mod( 'fb_show_marquee', true ) ) : $items = fb_marquee_items(); if ( $items ) : ?>
	<div class="marquee" aria-label="<?php esc_attr_e( 'Now showing', 'filmybuff' ); ?>"><div class="marquee__track">
		<?php foreach ( array_merge( $items, $items ) as $t ) echo '<span>' . esc_html( $t ) . '</span>'; ?>
	</div></div>
<?php endif; endif; ?>
<header class="masthead">
	<div class="wrap masthead__row">
		<a class="brand" href="<?php echo esc_url( home_url( '/' ) ); ?>" rel="home" aria-label="<?php bloginfo( 'name' ); ?>">
			<?php if ( has_custom_logo() ) { $l = wp_get_attachment_image_src( get_theme_mod( 'custom_logo' ), 'full' ); echo '<img src="' . esc_url( $l[0] ) . '" alt="">'; } else { fb_lockup(); } ?>
		</a>
		<nav id="primary-nav" class="primary-nav" aria-label="<?php esc_attr_e( 'Sections', 'filmybuff' ); ?>">
			<?php if ( has_nav_menu( 'primary' ) ) { wp_nav_menu( array( 'theme_location' => 'primary', 'container' => false, 'depth' => 1 ) ); } else { echo '<ul>'; wp_list_categories( array( 'title_li' => '', 'number' => 6, 'orderby' => 'count', 'order' => 'DESC' ) ); echo '</ul>'; } ?>
		</nav>
		<div class="masthead__tools">
			<button class="icon-btn search-toggle" aria-controls="search-bar" aria-expanded="false" aria-label="<?php esc_attr_e( 'Search', 'filmybuff' ); ?>"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="square"><circle cx="11" cy="11" r="7"></circle><line x1="16.5" y1="16.5" x2="22" y2="22"></line></svg></button>
			<button class="icon-btn menu-toggle" aria-controls="primary-nav" aria-expanded="false" aria-label="<?php esc_attr_e( 'Menu', 'filmybuff' ); ?>"><span></span><span></span><span></span></button>
		</div>
	</div>
	<div id="search-bar" class="search-bar"><div class="wrap"><?php get_search_form(); ?></div></div>
</header>
