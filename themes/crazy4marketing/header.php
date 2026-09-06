<!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo( 'charset' ); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" type="image/png" href="<?php echo esc_url( get_template_directory_uri() . '/assets/img/favicon.png' ); ?>" sizes="32x32">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>
<div class="site">
<?php if ( get_theme_mod( 'c4_show_ticker', true ) ) : $items = c4_ticker_items(); if ( $items ) : ?>
	<div class="ticker" aria-label="<?php esc_attr_e( 'Breaking news', 'crazy4marketing' ); ?>">
		<div class="ticker__label"><?php esc_html_e( 'Breaking', 'crazy4marketing' ); ?></div>
		<div class="ticker__track"><div class="ticker__strip"><?php foreach ( array_merge( $items, $items ) as $t ) echo '<span>' . esc_html( $t ) . '</span>'; ?></div></div>
	</div>
<?php endif; endif; ?>
<header class="site-header">
	<div class="site-header__row">
		<a class="brand" href="<?php echo esc_url( home_url( '/' ) ); ?>" rel="home">
			<?php if ( has_custom_logo() ) { $l = wp_get_attachment_image_src( get_theme_mod( 'custom_logo' ), 'full' ); echo '<img src="' . esc_url( $l[0] ) . '" alt="">'; } else { ?><img src="<?php echo esc_url( get_template_directory_uri() . '/assets/symbol_dark.png' ); ?>" alt=""><?php } ?>
			<span class="brand__word">crazy4<span>marketing.</span></span>
		</a>
		<div class="header-right">
			<span class="date"><?php echo esc_html( wp_date( 'D, j M Y' ) ); ?></span>
			<a class="btn" href="#newsletter"><?php esc_html_e( 'Subscribe', 'crazy4marketing' ); ?></a>
			<button class="menu-toggle" aria-controls="primary-nav" aria-expanded="false" aria-label="<?php esc_attr_e( 'Menu', 'crazy4marketing' ); ?>"><span></span><span></span><span></span></button>
		</div>
		<nav id="primary-nav" class="primary-nav" aria-label="<?php esc_attr_e( 'Sections', 'crazy4marketing' ); ?>">
			<?php if ( has_nav_menu( 'primary' ) ) { wp_nav_menu( array( 'theme_location' => 'primary', 'container' => false, 'depth' => 1 ) ); } else { wp_list_categories( array( 'title_li' => '', 'number' => 6, 'orderby' => 'count', 'order' => 'DESC' ) ); } ?>
		</nav>
	</div>
</header>
