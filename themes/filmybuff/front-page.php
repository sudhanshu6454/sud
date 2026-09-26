<?php get_header();
$shown = array();
$lead = new WP_Query( array( 'posts_per_page' => 1, 'post__in' => get_option( 'sticky_posts' ) ?: array( 0 ), 'ignore_sticky_posts' => 1, 'no_found_rows' => true ) );
if ( ! $lead->have_posts() ) $lead = new WP_Query( array( 'posts_per_page' => 1, 'no_found_rows' => true ) );
?>
<main id="main">
<section class="hero rule"><div class="wrap">
	<?php while ( $lead->have_posts() ) : $lead->the_post(); $shown[] = get_the_ID(); $c = fb_primary_cat(); ?>
	<div class="hero__grid">
		<article class="hero__lead">
			<span class="kicker"><?php echo $c ? esc_html( $c->name ) : ''; ?> · <?php esc_html_e( 'Lead story', 'filmybuff' ); ?></span>
			<h1><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h1>
			<p class="dek"><?php echo esc_html( get_the_excerpt() ); ?></p>
			<div class="meta"><?php echo esc_html( get_the_date() ); ?><span>·</span><?php echo esc_html( fb_reading_time() ); ?></div>
		</article>
		<a class="thumb thumb--cover" href="<?php the_permalink(); ?>"><?php the_post_thumbnail( 'fb-lead' ); ?></a>
	</div>
	<?php endwhile; wp_reset_postdata(); ?>
	<?php $sec = new WP_Query( array( 'posts_per_page' => 3, 'post__not_in' => $shown, 'ignore_sticky_posts' => 1, 'no_found_rows' => true ) ); if ( $sec->have_posts() ) : ?>
	<div class="hero__secondary">
		<?php while ( $sec->have_posts() ) : $sec->the_post(); $shown[] = get_the_ID(); $c = fb_primary_cat(); ?>
		<article>
			<a class="thumb thumb--cover" href="<?php the_permalink(); ?>"><?php if ( has_post_thumbnail() ) the_post_thumbnail( 'fb-card' ); ?></a>
			<span class="kicker"><?php echo $c ? esc_html( $c->name ) : ''; ?></span>
			<h3><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h3>
			<span class="meta"><?php echo esc_html( human_time_diff( get_the_time( 'U' ) ) . ' ' . __( 'ago', 'filmybuff' ) ); ?> · <?php echo esc_html( fb_reading_time() ); ?></span>
		</article>
		<?php endwhile; wp_reset_postdata(); ?>
	</div>
	<?php endif; ?>
</div></section>

<?php $slugs = array_filter( array_map( 'trim', explode( ',', get_theme_mod( 'fb_rail_cats', 'bollywood,hollywood,south-cinema' ) ) ) ); $rails = array();
foreach ( $slugs as $slug ) { $cat = fb_cat( $slug ); if ( $cat ) $rails[] = $cat; }
if ( $rails ) : ?>
<section class="rule"><div class="wrap rails">
	<?php foreach ( $rails as $cat ) : $q = new WP_Query( array( 'cat' => $cat->term_id, 'posts_per_page' => 4, 'no_found_rows' => true, 'ignore_sticky_posts' => 1 ) ); if ( ! $q->have_posts() ) continue; ?>
	<div class="rail">
		<a class="rail__head" href="<?php echo esc_url( get_category_link( $cat ) ); ?>"><strong><?php echo esc_html( $cat->name ); ?></strong><small><?php esc_html_e( 'ALL →', 'filmybuff' ); ?></small></a>
		<?php $i = 0; while ( $q->have_posts() ) : $q->the_post(); fb_rail_item( ++$i ); endwhile; wp_reset_postdata(); ?>
	</div>
	<?php endforeach; ?>
</div></section>
<?php endif; ?>

<?php $ott = fb_cat( get_theme_mod( 'fb_ott_cat', 'ott-releases' ) );
$oq = $ott ? new WP_Query( array( 'cat' => $ott->term_id, 'posts_per_page' => 4, 'no_found_rows' => true, 'ignore_sticky_posts' => 1 ) ) : null;
if ( $oq && $oq->have_posts() ) : ?>
<section class="ott"><div class="wrap">
	<div class="section-title"><span><?php esc_html_e( 'Fresh on OTT', 'filmybuff' ); ?></span><a href="<?php echo esc_url( get_category_link( $ott ) ); ?>"><?php esc_html_e( 'Everything streaming →', 'filmybuff' ); ?></a></div>
	<div class="ott__grid">
		<?php while ( $oq->have_posts() ) : $oq->the_post(); ?>
		<article>
			<a class="thumb thumb--cover" href="<?php the_permalink(); ?>"><?php if ( has_post_thumbnail() ) the_post_thumbnail( 'fb-card' ); ?></a>
			<span class="kicker"><?php echo esc_html( $ott->name ); ?></span>
			<h3><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h3>
			<span class="meta"><?php echo esc_html( get_the_date() ); ?></span>
		</article>
		<?php endwhile; wp_reset_postdata(); ?>
	</div>
</div></section>
<?php endif; ?>

<?php $bo = fb_cat( get_theme_mod( 'fb_boxoffice_cat', 'box-office' ) );
$bq = $bo ? new WP_Query( array( 'cat' => $bo->term_id, 'posts_per_page' => 5, 'no_found_rows' => true, 'ignore_sticky_posts' => 1 ) ) : null;
if ( $bq && $bq->have_posts() ) : ?>
<section class="ledger rule"><div class="wrap">
	<div class="section-title"><span><?php esc_html_e( 'Box office', 'filmybuff' ); ?></span><a href="<?php echo esc_url( get_category_link( $bo ) ); ?>"><?php esc_html_e( 'All the numbers →', 'filmybuff' ); ?></a></div>
	<div class="ledger__grid">
		<div class="ledger__rows">
			<?php $i = 0; while ( $bq->have_posts() ) : $bq->the_post(); $i++; ?>
			<a class="ledger__row" href="<?php the_permalink(); ?>">
				<span class="n"><?php echo esc_html( str_pad( $i, 2, '0', STR_PAD_LEFT ) ); ?></span>
				<h4><?php the_title(); ?></h4>
				<span class="meta"><?php echo esc_html( human_time_diff( get_the_time( 'U' ) ) . ' ' . __( 'ago', 'filmybuff' ) ); ?></span>
			</a>
			<?php endwhile; wp_reset_postdata(); ?>
		</div>
		<aside class="ledger__aside">
			<span class="kicker"><?php esc_html_e( 'How we read the numbers', 'filmybuff' ); ?></span>
			<h3><?php echo esc_html( get_theme_mod( 'fb_ledger_title', 'Opening day tells you the marketing. Day eight tells you the film.' ) ); ?></h3>
			<p><?php echo esc_html( get_theme_mod( 'fb_ledger_body', 'We report collections as the trade reports them, in crore, gross and net where both are known, and we say when they are estimates.' ) ); ?></p>
			<a class="btn btn--ghost" href="<?php echo esc_url( get_category_link( $bo ) ); ?>"><?php esc_html_e( 'Box office section', 'filmybuff' ); ?></a>
		</aside>
	</div>
</div></section>
<?php endif; ?>

<?php $tr = fb_cat( get_theme_mod( 'fb_trailers_cat', 'trailers' ) );
$tq = $tr ? new WP_Query( array( 'cat' => $tr->term_id, 'posts_per_page' => 2, 'no_found_rows' => true, 'ignore_sticky_posts' => 1 ) ) : null;
if ( $tq && $tq->have_posts() ) : ?>
<section class="trailers rule"><div class="wrap">
	<div class="section-title"><span><?php esc_html_e( 'Trailers and first looks', 'filmybuff' ); ?></span><a href="<?php echo esc_url( get_category_link( $tr ) ); ?>"><?php esc_html_e( 'More →', 'filmybuff' ); ?></a></div>
	<div class="trailers__grid">
		<?php while ( $tq->have_posts() ) : $tq->the_post(); ?>
		<article>
			<a class="thumb thumb--wide" href="<?php the_permalink(); ?>"><?php if ( has_post_thumbnail() ) the_post_thumbnail( 'fb-wide' ); ?></a>
			<span class="kicker"><?php echo esc_html( $tr->name ); ?></span>
			<h3><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h3>
			<p class="dek"><?php echo esc_html( get_the_excerpt() ); ?></p>
		</article>
		<?php endwhile; wp_reset_postdata(); ?>
	</div>
</div></section>
<?php endif; ?>

<section class="latest" id="newsletter"><div class="wrap">
	<div class="two-col">
		<div class="two-col__main">
			<div class="section-title"><span><?php esc_html_e( 'Latest', 'filmybuff' ); ?></span><small><?php printf( esc_html__( 'Updated %s', 'filmybuff' ), esc_html( wp_date( 'H:i T' ) ) ); ?></small></div>
			<div class="card-grid">
				<?php $lt = new WP_Query( array( 'posts_per_page' => 8, 'post__not_in' => $shown, 'ignore_sticky_posts' => 1, 'no_found_rows' => true ) ); while ( $lt->have_posts() ) : $lt->the_post(); fb_card(); endwhile; wp_reset_postdata(); ?>
			</div>
		</div>
		<aside class="sidebar"><?php fb_trending(); fb_follow_box(); fb_newsletter(); dynamic_sidebar( 'sidebar-1' ); ?></aside>
	</div>
</div></section>
</main>
<?php get_footer();
