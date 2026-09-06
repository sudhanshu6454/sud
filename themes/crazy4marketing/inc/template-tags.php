<?php
if ( ! defined( 'ABSPATH' ) ) exit;

/** Card (3:2 thumb, kicker, title, dek, meta) */
function c4_card( $size = 'c4-card' ) { ?>
	<article <?php post_class( 'card' ); ?>>
		<a class="thumb thumb--3x2" href="<?php the_permalink(); ?>"><?php if ( has_post_thumbnail() ) the_post_thumbnail( $size ); ?></a>
		<?php $c = c4_primary_cat(); if ( $c ) : ?><a class="kicker" href="<?php echo esc_url( get_category_link( $c ) ); ?>"><?php echo esc_html( $c->name ); ?></a><?php endif; ?>
		<h3><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h3>
		<p class="dek"><?php echo esc_html( get_the_excerpt() ); ?></p>
		<div class="meta"><?php the_author_posts_link(); ?> · <?php echo esc_html( c4_reading_time() ); ?></div>
	</article>
<?php }

/** Numbered rail row */
function c4_rail_item( $n ) { ?>
	<a class="rail__item" href="<?php the_permalink(); ?>">
		<span class="n"><?php echo esc_html( str_pad( $n, 2, '0', STR_PAD_LEFT ) ); ?></span>
		<span><h4><?php the_title(); ?></h4><span class="meta"><?php echo esc_html( human_time_diff( get_the_time( 'U' ) ) . ' ' . __( 'ago', 'crazy4marketing' ) ); ?></span></span>
	</a>
<?php }

/** Trending list by views */
function c4_trending( $title = null, $cat = 0 ) {
	$args = array( 'posts_per_page' => 5, 'meta_key' => 'c4_views', 'orderby' => 'meta_value_num', 'no_found_rows' => true );
	if ( $cat ) $args['cat'] = $cat;
	$q = new WP_Query( $args );
	if ( ! $q->have_posts() ) { $q = new WP_Query( array( 'posts_per_page' => 5, 'no_found_rows' => true, 'cat' => $cat ) ); }
	if ( ! $q->have_posts() ) return; ?>
	<div class="widget trending">
		<h3 class="widget-title"><?php echo esc_html( $title ?: __( 'Trending', 'crazy4marketing' ) ); ?></h3>
		<ul><?php $i = 0; while ( $q->have_posts() ) : $q->the_post(); $i++; ?>
			<li><span class="n"><?php echo esc_html( str_pad( $i, 2, '0', STR_PAD_LEFT ) ); ?></span>
				<span><h4><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h4>
				<span class="meta"><?php $v = get_post_meta( get_the_ID(), 'c4_views', true ); echo $v ? esc_html( c4_format_views( $v ) . ' ' . __( 'reads', 'crazy4marketing' ) ) : esc_html( get_the_date() ); ?></span></span></li>
		<?php endwhile; wp_reset_postdata(); ?></ul>
	</div>
<?php }

/** Newsletter block */
function c4_newsletter() { $action = get_theme_mod( 'c4_newsletter_action', '' ); ?>
	<div class="widget newsletter">
		<span class="kicker"><?php esc_html_e( 'Newsletter', 'crazy4marketing' ); ?></span>
		<h3><?php echo esc_html( get_theme_mod( 'c4_newsletter_title', 'The Marketing Edit, in your inbox before your 10 AM.' ) ); ?></h3>
		<p><?php echo esc_html( get_theme_mod( 'c4_newsletter_body', 'One email a day. Five stories. No synergy.' ) ); ?></p>
		<form method="post" action="<?php echo esc_url( $action ? $action : '#' ); ?>" target="_blank">
			<label class="screen-reader-text" for="c4-email"><?php esc_html_e( 'Email', 'crazy4marketing' ); ?></label>
			<input class="input" id="c4-email" type="email" name="EMAIL" required placeholder="you@agency.com">
			<button class="btn" type="submit"><?php esc_html_e( 'Subscribe →', 'crazy4marketing' ); ?></button>
		</form>
		<small><?php esc_html_e( "Unsubscribe any time. We don't sell lists.", 'crazy4marketing' ); ?></small>
	</div>
<?php }

/** Follow box (cream) */
function c4_follow_box() { $h = get_theme_mod( 'c4_instagram', 'crazy4marketing' ); ?>
	<div class="widget follow-box">
		<span class="kicker"><?php esc_html_e( 'Follow', 'crazy4marketing' ); ?></span>
		<h3><?php esc_html_e( 'Every story, first on Instagram.', 'crazy4marketing' ); ?></h3>
		<a href="<?php echo esc_url( 'https://instagram.com/' . $h ); ?>">@<?php echo esc_html( $h ); ?> →</a>
	</div>
<?php }

/** Author initials fallback */
function c4_author_initials( $id ) {
	$name = get_the_author_meta( 'display_name', $id );
	$parts = preg_split( '/\s+/', trim( $name ) );
	$ini = '';
	foreach ( array_slice( $parts, 0, 2 ) as $p ) $ini .= mb_substr( $p, 0, 1 );
	return mb_strtoupper( $ini );
}
