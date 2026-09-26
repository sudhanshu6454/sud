<?php
if ( ! defined( 'ABSPATH' ) ) exit;

/** The lockup as the kit builds it: a bordered box, FILMY over BUFF, the square after BUFF. */
function fb_lockup( $class = '' ) {
	echo '<span class="lockup ' . esc_attr( $class ) . '" aria-hidden="true"><span>FILMY</span><span>BUFF<i></i></span></span>';
}

/** Card (3:2 thumb, kicker, title, dek, meta) */
function fb_card( $size = 'fb-card' ) { ?>
	<article <?php post_class( 'card' ); ?>>
		<a class="thumb thumb--cover" href="<?php the_permalink(); ?>"><?php if ( has_post_thumbnail() ) the_post_thumbnail( $size ); ?></a>
		<?php $c = fb_primary_cat(); if ( $c ) : ?><a class="kicker" href="<?php echo esc_url( get_category_link( $c ) ); ?>"><?php echo esc_html( $c->name ); ?></a><?php endif; ?>
		<h3><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h3>
		<p class="dek"><?php echo esc_html( get_the_excerpt() ); ?></p>
		<div class="meta"><?php echo esc_html( get_the_date() ); ?> · <?php echo esc_html( fb_reading_time() ); ?></div>
	</article>
<?php }

/** Numbered rail row */
function fb_rail_item( $n ) { ?>
	<a class="rail__item" href="<?php the_permalink(); ?>">
		<span class="n"><?php echo esc_html( str_pad( $n, 2, '0', STR_PAD_LEFT ) ); ?></span>
		<span><h4><?php the_title(); ?></h4><span class="meta"><?php echo esc_html( human_time_diff( get_the_time( 'U' ) ) . ' ' . __( 'ago', 'filmybuff' ) ); ?></span></span>
	</a>
<?php }

/** Trending list by views */
function fb_trending( $title = null, $cat = 0 ) {
	$args = array( 'posts_per_page' => 5, 'meta_key' => 'fb_views', 'orderby' => 'meta_value_num', 'no_found_rows' => true, 'ignore_sticky_posts' => 1 );
	if ( $cat ) $args['cat'] = $cat;
	$q = new WP_Query( $args );
	if ( ! $q->have_posts() ) { $q = new WP_Query( array( 'posts_per_page' => 5, 'no_found_rows' => true, 'cat' => $cat, 'ignore_sticky_posts' => 1 ) ); }
	if ( ! $q->have_posts() ) return; ?>
	<div class="widget trending">
		<h3 class="widget-title"><?php echo esc_html( $title ?: __( 'Most read', 'filmybuff' ) ); ?></h3>
		<ul><?php $i = 0; while ( $q->have_posts() ) : $q->the_post(); $i++; ?>
			<li><span class="n"><?php echo esc_html( str_pad( $i, 2, '0', STR_PAD_LEFT ) ); ?></span>
				<span><h4><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h4>
				<span class="meta"><?php $v = get_post_meta( get_the_ID(), 'fb_views', true ); echo $v ? esc_html( fb_format_views( $v ) . ' ' . __( 'reads', 'filmybuff' ) ) : esc_html( get_the_date() ); ?></span></span></li>
		<?php endwhile; wp_reset_postdata(); ?></ul>
	</div>
<?php }

/** Newsletter block */
function fb_newsletter() { $action = get_theme_mod( 'fb_newsletter_action', '' ); ?>
	<div class="widget newsletter">
		<span class="kicker"><?php esc_html_e( 'Newsletter', 'filmybuff' ); ?></span>
		<h3><?php echo esc_html( get_theme_mod( 'fb_newsletter_title', 'Friday releases, Sunday numbers, in your inbox.' ) ); ?></h3>
		<p><?php echo esc_html( get_theme_mod( 'fb_newsletter_body', 'One email a week: what opened, what worked, what to watch.' ) ); ?></p>
		<form method="post" action="<?php echo esc_url( $action ? $action : '#' ); ?>" target="_blank">
			<label class="screen-reader-text" for="fb-email"><?php esc_html_e( 'Email', 'filmybuff' ); ?></label>
			<input class="input" id="fb-email" type="email" name="EMAIL" required placeholder="you@example.com">
			<button class="btn" type="submit"><?php esc_html_e( 'Subscribe →', 'filmybuff' ); ?></button>
		</form>
		<small><?php esc_html_e( "Unsubscribe any time. We don't sell lists.", 'filmybuff' ); ?></small>
	</div>
<?php }

/** Follow box (ink) */
function fb_follow_box() { $h = get_theme_mod( 'fb_instagram', 'filmybuff' ); ?>
	<div class="widget follow-box">
		<span class="kicker"><?php esc_html_e( 'Follow', 'filmybuff' ); ?></span>
		<h3><?php esc_html_e( 'Reviews, classics, trivia and what is coming, on Instagram.', 'filmybuff' ); ?></h3>
		<a class="handle" href="<?php echo esc_url( 'https://instagram.com/' . $h ); ?>">@<?php echo esc_html( $h ); ?> →</a>
	</div>
<?php }

/** Top bar: Customizer text (one per line) or the newest titles */
function fb_topbar_items() {
	$raw = trim( (string) get_theme_mod( 'fb_topbar_text', '' ) );
	if ( $raw !== '' ) return array_filter( array_map( 'trim', explode( "\n", $raw ) ) );
	$q = new WP_Query( array( 'posts_per_page' => 3, 'no_found_rows' => true ) );
	return wp_list_pluck( $q->posts, 'post_title' );
}

/** Author initials */
function fb_author_initials( $id ) {
	$name = get_the_author_meta( 'display_name', $id );
	$parts = preg_split( '/\s+/', trim( $name ) );
	$ini = '';
	foreach ( array_slice( $parts, 0, 2 ) as $p ) $ini .= mb_substr( $p, 0, 1 );
	return mb_strtoupper( $ini );
}
