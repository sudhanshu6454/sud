<?php
/**
 * The front page as a bill: every image is the 3:4 poster the grid carries, in its own frame, with the
 * type on the ink beside or beneath it; nothing is ever set over a poster. Lead story, the three next to it, fresh prints, the watchlist shelf, the screens,
 * the box office board, trailers, streaming, then the stubs.
 */
get_header();
$shown = array();
$lead = new WP_Query( array( 'posts_per_page' => 4, 'post__in' => get_option( 'sticky_posts' ) ?: array( 0 ), 'ignore_sticky_posts' => 1, 'no_found_rows' => true ) );
if ( ! $lead->have_posts() ) $lead = new WP_Query( array( 'posts_per_page' => 4, 'ignore_sticky_posts' => 1, 'no_found_rows' => true ) );
elseif ( $lead->post_count < 4 ) {
	$more = new WP_Query( array( 'posts_per_page' => 4 - $lead->post_count, 'post__not_in' => wp_list_pluck( $lead->posts, 'ID' ), 'ignore_sticky_posts' => 1, 'no_found_rows' => true ) );
	$lead->posts = array_merge( $lead->posts, $more->posts ); $lead->post_count = count( $lead->posts );
}
?>
<main id="main">
<?php if ( $lead->have_posts() ) : ?>
<section class="bill"><div class="wrap">
	<div class="bill__grid">
	<?php $i = 0; while ( $lead->have_posts() ) : $lead->the_post(); $shown[] = get_the_ID(); $c = fb_primary_cat(); $i++; if ( $i === 1 ) : ?>
		<div class="bill__copy">
			<div class="bill__cert"><span class="cert cert--red"><?php esc_html_e( 'NOW', 'filmybuff' ); ?></span><span class="kicker"><?php echo $c ? esc_html( $c->name ) : ''; ?> · <?php echo esc_html( wp_date( 'l' ) ); ?></span></div>
			<h1><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h1>
			<p class="dek"><?php echo esc_html( get_the_excerpt() ); ?></p>
			<div class="bill__foot">
				<a class="btn" href="<?php the_permalink(); ?>"><?php esc_html_e( 'Read the story', 'filmybuff' ); ?> →</a>
				<span class="meta"><?php echo esc_html( get_the_date() ); ?> · <?php echo esc_html( fb_reading_time() ); ?></span>
			</div>
		</div>
		<a class="bill__still <?php echo has_post_thumbnail() ? '' : 'bill__still--empty'; ?>" href="<?php the_permalink(); ?>">
			<span class="thumb"><?php if ( has_post_thumbnail() ) the_post_thumbnail( 'fb-poster-lg' ); else fb_lockup( 'lockup--big' ); ?></span>
			<span class="bill__cap"><span><?php echo $c ? esc_html( $c->name ) : esc_html__( 'Story', 'filmybuff' ); ?></span><span><?php echo esc_html( get_the_date( 'd M' ) ); ?></span></span>
		</a>
		<div class="bill__also">
	<?php else : ?>
			<a class="also-row" href="<?php the_permalink(); ?>">
				<span class="n"><?php echo esc_html( str_pad( $i - 1, 2, '0', STR_PAD_LEFT ) ); ?></span>
				<span><span class="kicker"><?php echo $c ? esc_html( $c->name ) : ''; ?></span><h3><?php the_title(); ?></h3><span class="meta"><?php echo esc_html( human_time_diff( get_the_time( 'U' ) ) . ' ' . __( 'ago', 'filmybuff' ) ); ?></span></span>
			</a>
	<?php endif; endwhile; wp_reset_postdata(); ?>
		</div>
	</div>
</div></section>
<?php endif; ?>
<div class="strip" aria-hidden="true"></div>

<?php $fresh = new WP_Query( array( 'posts_per_page' => 8, 'post__not_in' => $shown, 'ignore_sticky_posts' => 1, 'no_found_rows' => true ) ); if ( $fresh->have_posts() ) : ?>
<section class="prints"><div class="wrap">
	<div class="act"><h2><?php esc_html_e( 'Fresh prints', 'filmybuff' ); ?></h2><span class="act__line"></span><small class="meta"><?php printf( esc_html__( 'Updated %s', 'filmybuff' ), esc_html( wp_date( 'H:i T' ) ) ); ?></small></div>
	<div class="prints__grid">
		<?php while ( $fresh->have_posts() ) : $fresh->the_post(); $shown[] = get_the_ID(); fb_print(); endwhile; wp_reset_postdata(); ?>
	</div>
	<?php $page_for_posts = get_option( 'page_for_posts' ); ?>
	<div class="prints__more"><a class="btn btn--ghost" href="<?php echo esc_url( $page_for_posts ? get_permalink( $page_for_posts ) : home_url( '/?s=' ) ); ?>"><?php esc_html_e( 'Every story', 'filmybuff' ); ?> →</a></div>
</div></section>
<?php endif; ?>

<?php $wl = fb_cat( get_theme_mod( 'fb_watchlists_cat', 'watchlists' ) );
$wq = $wl ? new WP_Query( array( 'cat' => $wl->term_id, 'posts_per_page' => 5, 'no_found_rows' => true, 'ignore_sticky_posts' => 1 ) ) : null;
if ( $wq && $wq->have_posts() ) : ?>
<section class="sleeves"><div class="wrap">
	<div class="act"><h2><?php esc_html_e( 'What to watch', 'filmybuff' ); ?></h2><span class="act__line"></span><a href="<?php echo esc_url( get_category_link( $wl ) ); ?>"><?php esc_html_e( 'All the watchlists →', 'filmybuff' ); ?></a></div>
	<div class="sleeves__track">
		<?php $i = 0; while ( $wq->have_posts() ) : $wq->the_post(); fb_sleeve( ++$i ); endwhile; wp_reset_postdata(); ?>
	</div>
</div></section>
<?php endif; ?>

<?php $slugs = array_filter( array_map( 'trim', explode( ',', get_theme_mod( 'fb_rail_cats', 'bollywood,hollywood,south-cinema' ) ) ) ); $screens = array();
foreach ( $slugs as $slug ) { $cat = fb_cat( $slug ); if ( $cat ) $screens[] = $cat; }
if ( $screens ) : ?>
<section class="screens"><div class="wrap">
	<div class="act"><h2><?php esc_html_e( 'By screen', 'filmybuff' ); ?></h2><span class="act__line"></span></div>
	<div class="screens__grid">
	<?php foreach ( $screens as $k => $cat ) : $q = new WP_Query( array( 'cat' => $cat->term_id, 'posts_per_page' => 5, 'no_found_rows' => true, 'ignore_sticky_posts' => 1 ) ); ?>
		<div class="screen">
			<a class="screen__head" href="<?php echo esc_url( get_category_link( $cat ) ); ?>"><span class="screen__no"><?php echo esc_html( str_pad( $k + 1, 2, '0', STR_PAD_LEFT ) ); ?></span><strong><?php echo esc_html( $cat->name ); ?></strong><small><?php esc_html_e( 'All →', 'filmybuff' ); ?></small></a>
			<?php if ( ! $q->have_posts() ) : ?><p class="meta"><?php esc_html_e( 'The projector is warming up.', 'filmybuff' ); ?></p><?php endif; ?>
			<?php $i = 0; while ( $q->have_posts() ) : $q->the_post(); $i++; ?>
			<a class="frame <?php echo $i === 1 ? 'frame--lead' : ''; ?>" href="<?php the_permalink(); ?>"><span class="n"><?php echo esc_html( str_pad( $i, 2, '0', STR_PAD_LEFT ) ); ?></span><h4><?php the_title(); ?></h4><span class="meta"><?php echo esc_html( human_time_diff( get_the_time( 'U' ) ) . ' ' . __( 'ago', 'filmybuff' ) ); ?></span></a>
			<?php endwhile; wp_reset_postdata(); ?>
		</div>
	<?php endforeach; ?>
	</div>
</div></section>
<?php endif; ?>

<?php $bo = fb_cat( get_theme_mod( 'fb_boxoffice_cat', 'box-office' ) );
$bq = $bo ? new WP_Query( array( 'cat' => $bo->term_id, 'posts_per_page' => 5, 'no_found_rows' => true, 'ignore_sticky_posts' => 1 ) ) : null;
if ( $bq && $bq->have_posts() ) : ?>
<div class="strip strip--red" aria-hidden="true"></div>
<section class="board"><div class="wrap">
	<div class="act"><h2><?php esc_html_e( 'Box office board', 'filmybuff' ); ?></h2><span class="act__line"></span><a href="<?php echo esc_url( get_category_link( $bo ) ); ?>"><?php esc_html_e( 'All the numbers →', 'filmybuff' ); ?></a></div>
	<div class="board__grid">
		<div class="board__rows">
			<?php $i = 0; while ( $bq->have_posts() ) : $bq->the_post(); $i++; ?>
			<a class="board__row" href="<?php the_permalink(); ?>">
				<span class="n"><?php echo esc_html( str_pad( $i, 2, '0', STR_PAD_LEFT ) ); ?></span>
				<h4><?php the_title(); ?></h4>
				<span class="meta"><?php echo esc_html( human_time_diff( get_the_time( 'U' ) ) . ' ' . __( 'ago', 'filmybuff' ) ); ?></span>
			</a>
			<?php endwhile; wp_reset_postdata(); ?>
		</div>
		<aside class="board__note">
			<span class="kicker"><?php esc_html_e( 'How we read the numbers', 'filmybuff' ); ?></span>
			<h3><?php echo esc_html( get_theme_mod( 'fb_ledger_title', 'Opening day tells you the marketing. Day eight tells you the film.' ) ); ?></h3>
			<p><?php echo esc_html( get_theme_mod( 'fb_ledger_body', 'We report collections as the trade reports them, in crore, gross and net where both are known, and we say when they are estimates.' ) ); ?></p>
			<a class="btn btn--ink" href="<?php echo esc_url( get_category_link( $bo ) ); ?>"><?php esc_html_e( 'Box office', 'filmybuff' ); ?> →</a>
		</aside>
	</div>
</div></section>
<div class="strip strip--red" aria-hidden="true"></div>
<?php endif; ?>

<?php $tr = fb_cat( get_theme_mod( 'fb_trailers_cat', 'trailers' ) );
$tq = $tr ? new WP_Query( array( 'cat' => $tr->term_id, 'posts_per_page' => 4, 'no_found_rows' => true, 'ignore_sticky_posts' => 1 ) ) : null;
if ( $tq && $tq->have_posts() ) : ?>
<section class="trailers"><div class="wrap">
	<div class="act"><h2><?php esc_html_e( 'Trailers and first looks', 'filmybuff' ); ?></h2><span class="act__line"></span><a href="<?php echo esc_url( get_category_link( $tr ) ); ?>"><?php esc_html_e( 'More →', 'filmybuff' ); ?></a></div>
	<div class="trailers__grid">
		<?php $i = 0; while ( $tq->have_posts() ) : $tq->the_post(); $i++; if ( $i === 1 ) : ?>
		<a class="trailer" href="<?php the_permalink(); ?>">
			<span class="thumb"><?php if ( has_post_thumbnail() ) the_post_thumbnail( 'fb-poster-lg' ); ?><span class="trailer__play" aria-hidden="true"></span></span>
			<span class="trailer__body"><span class="kicker"><?php echo esc_html( $tr->name ); ?> · <?php echo esc_html( get_the_date( 'd M' ) ); ?></span><h3><?php the_title(); ?></h3><p class="dek"><?php echo esc_html( get_the_excerpt() ); ?></p></span>
		</a>
		<div class="trailers__list">
		<?php else : ?>
			<a class="trailer-row" href="<?php the_permalink(); ?>">
				<span class="thumb"><?php if ( has_post_thumbnail() ) the_post_thumbnail( 'fb-poster' ); ?><span class="trailer__play trailer__play--sm" aria-hidden="true"></span></span>
				<span><h4><?php the_title(); ?></h4><span class="meta"><?php echo esc_html( human_time_diff( get_the_time( 'U' ) ) . ' ' . __( 'ago', 'filmybuff' ) ); ?></span></span>
			</a>
		<?php endif; endwhile; wp_reset_postdata(); ?>
		</div>
	</div>
</div></section>
<?php endif; ?>

<?php $ott = fb_cat( get_theme_mod( 'fb_ott_cat', 'ott-releases' ) );
$oq = $ott ? new WP_Query( array( 'cat' => $ott->term_id, 'posts_per_page' => 4, 'no_found_rows' => true, 'ignore_sticky_posts' => 1 ) ) : null;
if ( $oq && $oq->have_posts() ) : ?>
<section class="ott"><div class="wrap">
	<div class="act"><h2><?php esc_html_e( 'Streaming tonight', 'filmybuff' ); ?></h2><span class="act__line"></span><a href="<?php echo esc_url( get_category_link( $ott ) ); ?>"><?php esc_html_e( 'Everything on OTT →', 'filmybuff' ); ?></a></div>
	<div class="ott__grid">
		<?php while ( $oq->have_posts() ) : $oq->the_post(); ?>
		<a class="ticket" href="<?php the_permalink(); ?>">
			<span class="kicker"><?php esc_html_e( 'Admit one', 'filmybuff' ); ?> · <?php echo esc_html( $ott->name ); ?></span>
			<h3><?php the_title(); ?></h3>
			<span class="meta"><?php echo esc_html( get_the_date() ); ?> · <?php echo esc_html( fb_reading_time() ); ?></span>
		</a>
		<?php endwhile; wp_reset_postdata(); ?>
	</div>
</div></section>
<?php endif; ?>

<?php fb_stubs(); ?>
</main>
<?php get_footer();
