<?php get_header();
$shown = array();
$lead = new WP_Query( array( 'posts_per_page' => 1, 'post__in' => get_option( 'sticky_posts' ) ?: array( 0 ), 'ignore_sticky_posts' => 1, 'no_found_rows' => true ) );
if ( ! $lead->have_posts() ) $lead = new WP_Query( array( 'posts_per_page' => 1, 'ignore_sticky_posts' => 1, 'no_found_rows' => true ) );
?>
<main id="main">
<?php while ( $lead->have_posts() ) : $lead->the_post(); $shown[] = get_the_ID(); $c = fb_primary_cat(); ?>
<section class="pick">
	<div class="pick__bg"><?php if ( has_post_thumbnail() ) the_post_thumbnail( 'fb-hero' ); ?></div>
	<div class="wrap pick__body">
		<div class="pick__cert"><span class="cert cert--red"><?php esc_html_e( 'PICK', 'filmybuff' ); ?></span><span class="kicker" style="color:var(--fb-paper)"><?php echo $c ? esc_html( $c->name ) : ''; ?> · <?php esc_html_e( "Tonight's story", 'filmybuff' ); ?></span></div>
		<h1><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h1>
		<p class="dek"><?php echo esc_html( get_the_excerpt() ); ?></p>
		<div class="pick__foot">
			<a class="btn" href="<?php the_permalink(); ?>"><?php esc_html_e( 'Read the story', 'filmybuff' ); ?> →</a>
			<span class="meta"><?php echo esc_html( get_the_date() ); ?> · <?php echo esc_html( fb_reading_time() ); ?></span>
		</div>
	</div>
</section>
<?php endwhile; wp_reset_postdata(); ?>
<div class="strip" aria-hidden="true"></div>

<?php $now = new WP_Query( array( 'posts_per_page' => 10, 'post__not_in' => $shown, 'ignore_sticky_posts' => 1, 'no_found_rows' => true ) ); if ( $now->have_posts() ) : ?>
<section class="shelf"><div class="wrap">
	<div class="act"><h2><?php esc_html_e( 'Now showing', 'filmybuff' ); ?></h2><span class="act__line"></span><a href="<?php echo esc_url( home_url( '/?s=' ) ); ?>#log"><?php esc_html_e( 'Scroll →', 'filmybuff' ); ?></a></div>
	<div class="shelf__track">
		<?php $i = 0; while ( $now->have_posts() ) : $now->the_post(); $shown[] = get_the_ID(); fb_poster( ++$i ); endwhile; wp_reset_postdata(); ?>
	</div>
</div></section>
<?php endif; ?>

<?php $slugs = array_filter( array_map( 'trim', explode( ',', get_theme_mod( 'fb_rail_cats', 'bollywood,hollywood,south-cinema' ) ) ) ); $reels = array();
foreach ( $slugs as $slug ) { $cat = fb_cat( $slug ); if ( $cat ) $reels[] = $cat; }
if ( $reels ) : ?>
<section class="reels"><div class="wrap">
	<div class="act"><h2><?php esc_html_e( 'The reels', 'filmybuff' ); ?></h2><span class="act__line"></span></div>
	<div class="reels__grid">
	<?php foreach ( $reels as $cat ) : $q = new WP_Query( array( 'cat' => $cat->term_id, 'posts_per_page' => 4, 'no_found_rows' => true, 'ignore_sticky_posts' => 1 ) ); ?>
		<div class="reel">
			<div class="reel__head"><strong><?php echo esc_html( $cat->name ); ?></strong><a href="<?php echo esc_url( get_category_link( $cat ) ); ?>"><small><?php esc_html_e( 'All →', 'filmybuff' ); ?></small></a></div>
			<?php if ( ! $q->have_posts() ) : ?><p class="meta"><?php esc_html_e( 'The projector is warming up.', 'filmybuff' ); ?></p><?php endif; ?>
			<?php $i = 0; while ( $q->have_posts() ) : $q->the_post(); $i++; if ( $i === 1 ) : ?>
			<a class="reel__lead" href="<?php the_permalink(); ?>">
				<span class="thumb"><?php if ( has_post_thumbnail() ) the_post_thumbnail( 'fb-card' ); ?></span>
				<h3><?php the_title(); ?></h3>
				<span class="meta"><?php echo esc_html( human_time_diff( get_the_time( 'U' ) ) . ' ' . __( 'ago', 'filmybuff' ) ); ?> · <?php echo esc_html( fb_reading_time() ); ?></span>
			</a>
			<?php else : ?>
			<a class="frame" href="<?php the_permalink(); ?>"><span class="n"><?php echo esc_html( str_pad( $i - 1, 2, '0', STR_PAD_LEFT ) ); ?></span><h4><?php the_title(); ?></h4></a>
			<?php endif; endwhile; wp_reset_postdata(); ?>
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

<?php $tr = fb_cat( get_theme_mod( 'fb_trailers_cat', 'trailers' ) );
$tq = $tr ? new WP_Query( array( 'cat' => $tr->term_id, 'posts_per_page' => 2, 'no_found_rows' => true, 'ignore_sticky_posts' => 1 ) ) : null;
if ( $tq && $tq->have_posts() ) : ?>
<section class="trailers"><div class="wrap">
	<div class="act"><h2><?php esc_html_e( 'Trailers and first looks', 'filmybuff' ); ?></h2><span class="act__line"></span><a href="<?php echo esc_url( get_category_link( $tr ) ); ?>"><?php esc_html_e( 'More →', 'filmybuff' ); ?></a></div>
	<div class="trailers__grid">
		<?php while ( $tq->have_posts() ) : $tq->the_post(); ?>
		<a class="trailer" href="<?php the_permalink(); ?>">
			<span class="thumb"><?php if ( has_post_thumbnail() ) the_post_thumbnail( 'fb-wide' ); ?></span>
			<span class="trailer__play" aria-hidden="true"></span>
			<span class="trailer__body"><span class="kicker"><?php echo esc_html( $tr->name ); ?></span><h3><?php the_title(); ?></h3><p class="dek"><?php echo esc_html( get_the_excerpt() ); ?></p></span>
		</a>
		<?php endwhile; wp_reset_postdata(); ?>
	</div>
</div></section>
<?php endif; ?>

<?php $lt = new WP_Query( array( 'posts_per_page' => 8, 'post__not_in' => $shown, 'ignore_sticky_posts' => 1, 'no_found_rows' => true ) ); if ( $lt->have_posts() ) : ?>
<section class="log" id="log"><div class="wrap">
	<div class="act"><h2><?php esc_html_e( 'The screening log', 'filmybuff' ); ?></h2><span class="act__line"></span><small class="meta"><?php printf( esc_html__( 'Updated %s', 'filmybuff' ), esc_html( wp_date( 'H:i T' ) ) ); ?></small></div>
	<div class="log__list"><?php while ( $lt->have_posts() ) : $lt->the_post(); fb_log_row(); endwhile; wp_reset_postdata(); ?></div>
	<?php $page_for_posts = get_option( 'page_for_posts' ); ?>
	<div class="log__more"><a class="btn btn--ghost" href="<?php echo esc_url( $page_for_posts ? get_permalink( $page_for_posts ) : home_url( '/?s=' ) ); ?>"><?php esc_html_e( 'Every story', 'filmybuff' ); ?> →</a></div>
</div></section>
<?php endif; ?>

<?php fb_stubs(); ?>
</main>
<?php get_footer();
