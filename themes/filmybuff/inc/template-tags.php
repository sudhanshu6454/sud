<?php
if ( ! defined( 'ABSPATH' ) ) exit;

/** The lockup as the kit builds it: a bordered box, FILMY over BUFF, the square after BUFF. */
function fb_lockup( $class = '' ) {
	echo '<span class="lockup ' . esc_attr( $class ) . '" aria-hidden="true"><span>FILMY</span><span>BUFF<i></i></span></span>';
}

/** A poster card (2:3): the still, a screen number, the section, the title over the gradient. */
function fb_poster( $n = 0 ) { $c = fb_primary_cat(); ?>
	<a class="poster <?php echo has_post_thumbnail() ? '' : 'poster--empty'; ?>" href="<?php the_permalink(); ?>">
		<?php if ( has_post_thumbnail() ) the_post_thumbnail( 'fb-poster' ); ?>
		<?php if ( $n ) : ?><span class="poster__n"><?php echo esc_html( str_pad( $n, 2, '0', STR_PAD_LEFT ) ); ?></span><?php endif; ?>
		<?php if ( $c ) : ?><span class="poster__cat"><?php echo esc_html( $c->name ); ?></span><?php endif; ?>
		<span class="poster__body"><h3><?php the_title(); ?></h3><span class="meta"><?php echo esc_html( human_time_diff( get_the_time( 'U' ) ) . ' ' . __( 'ago', 'filmybuff' ) ); ?> · <?php echo esc_html( fb_reading_time() ); ?></span></span>
	</a>
<?php }

/** A fresh print: the still in its own frame, the section, the title and the standfirst under it. */
function fb_print() { $c = fb_primary_cat(); ?>
	<article <?php post_class( 'print' ); ?>>
		<a class="thumb thumb--cover" href="<?php the_permalink(); ?>"><?php if ( has_post_thumbnail() ) the_post_thumbnail( 'fb-card' ); ?></a>
		<div class="print__body">
			<?php if ( $c ) : ?><a class="kicker" href="<?php echo esc_url( get_category_link( $c ) ); ?>"><?php echo esc_html( $c->name ); ?></a><?php endif; ?>
			<h3><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h3>
			<p class="dek"><?php echo esc_html( get_the_excerpt() ); ?></p>
			<span class="meta"><?php echo esc_html( human_time_diff( get_the_time( 'U' ) ) . ' ' . __( 'ago', 'filmybuff' ) ); ?> · <?php echo esc_html( fb_reading_time() ); ?></span>
		</div>
	</article>
<?php }

/** A sleeve: a 2:3 poster with the title set beneath it, never over it. */
function fb_sleeve( $n = 0 ) { ?>
	<a class="sleeve" href="<?php the_permalink(); ?>">
		<span class="sleeve__art <?php echo has_post_thumbnail() ? '' : 'sleeve__art--empty'; ?>"><?php if ( has_post_thumbnail() ) the_post_thumbnail( 'fb-poster' ); ?><?php if ( $n ) : ?><span class="poster__n"><?php echo esc_html( str_pad( $n, 2, '0', STR_PAD_LEFT ) ); ?></span><?php endif; ?></span>
		<h3><?php the_title(); ?></h3>
		<span class="meta"><?php echo esc_html( get_the_date( 'd M' ) ); ?> · <?php echo esc_html( fb_reading_time() ); ?></span>
	</a>
<?php }

/** A row of the screening log: the day large, the story, the still. */
function fb_log_row() { $c = fb_primary_cat(); ?>
	<article <?php post_class( 'log__row' ); ?>>
		<time datetime="<?php echo esc_attr( get_the_date( 'c' ) ); ?>"><b><?php echo esc_html( get_the_date( 'd' ) ); ?></b><?php echo esc_html( get_the_date( 'M Y' ) ); ?></time>
		<div>
			<?php if ( $c ) : ?><a class="kicker" href="<?php echo esc_url( get_category_link( $c ) ); ?>"><?php echo esc_html( $c->name ); ?></a><?php endif; ?>
			<h3><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h3>
			<p class="dek"><?php echo esc_html( get_the_excerpt() ); ?></p>
		</div>
		<a class="thumb" href="<?php the_permalink(); ?>"><?php if ( has_post_thumbnail() ) the_post_thumbnail( 'fb-card' ); ?></a>
	</article>
<?php }

/** The red stub band: follow + newsletter, on the home, archives and the index. */
function fb_stubs() { $h = get_theme_mod( 'fb_instagram', 'filmybuff' ); $action = get_theme_mod( 'fb_newsletter_action', '' ); ?>
	<section class="stubs" id="newsletter"><div class="wrap stubs__grid">
		<div class="stub">
			<span class="kicker"><?php esc_html_e( 'Follow', 'filmybuff' ); ?></span>
			<h3><?php esc_html_e( 'Reviews, classics, trivia, coming soon', 'filmybuff' ); ?></h3>
			<p><?php esc_html_e( 'Every story first on Instagram, and the reels you will actually watch.', 'filmybuff' ); ?></p>
			<a class="handle" href="<?php echo esc_url( 'https://instagram.com/' . $h ); ?>">@<?php echo esc_html( $h ); ?> →</a>
		</div>
		<div class="stub">
			<span class="kicker"><?php esc_html_e( 'Newsletter', 'filmybuff' ); ?></span>
			<h3><?php echo esc_html( get_theme_mod( 'fb_newsletter_title', 'Friday releases. Sunday numbers.' ) ); ?></h3>
			<p><?php echo esc_html( get_theme_mod( 'fb_newsletter_body', 'One email a week: what opened, what worked, what to watch.' ) ); ?></p>
			<form method="post" action="<?php echo esc_url( $action ? $action : '#' ); ?>" target="_blank">
				<label class="screen-reader-text" for="fb-email"><?php esc_html_e( 'Email', 'filmybuff' ); ?></label>
				<input class="input" id="fb-email" type="email" name="EMAIL" required placeholder="you@example.com">
				<button class="btn" type="submit"><?php esc_html_e( 'Admit me', 'filmybuff' ); ?></button>
			</form>
			<small><?php esc_html_e( "Unsubscribe any time. We don't sell lists.", 'filmybuff' ); ?></small>
		</div>
	</div></section>
<?php }

/** Marquee: Customizer text (one per line) or the newest titles */
function fb_marquee_items() {
	$raw = trim( (string) get_theme_mod( 'fb_marquee_text', '' ) );
	if ( $raw !== '' ) return array_filter( array_map( 'trim', explode( "\n", $raw ) ) );
	$q = new WP_Query( array( 'posts_per_page' => 6, 'no_found_rows' => true, 'ignore_sticky_posts' => 1 ) );
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
