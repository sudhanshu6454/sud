<?php get_header();
$shown = array();
$lead = new WP_Query( array( 'posts_per_page' => 1, 'post__in' => get_option( 'sticky_posts' ) ?: array( 0 ), 'ignore_sticky_posts' => 1, 'no_found_rows' => true ) );
if ( ! $lead->have_posts() ) $lead = new WP_Query( array( 'posts_per_page' => 1, 'no_found_rows' => true ) );
?>
<main id="main">
<section class="hero rule">
	<?php while ( $lead->have_posts() ) : $lead->the_post(); $shown[] = get_the_ID(); $c = c4_primary_cat(); ?>
	<div class="hero__grid">
		<article class="hero__lead">
			<span class="kicker"><?php echo $c ? esc_html( $c->name ) : ''; ?> · <?php esc_html_e( 'Lead story', 'crazy4marketing' ); ?></span>
			<h1><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h1>
			<p class="dek"><?php echo esc_html( get_the_excerpt() ); ?></p>
			<div class="meta"><?php the_author_posts_link(); ?><span>·</span><?php echo esc_html( get_the_date() ); ?><span>·</span><?php echo esc_html( c4_reading_time() ); ?></div>
		</article>
		<a class="thumb thumb--4x3" href="<?php the_permalink(); ?>"><?php the_post_thumbnail( 'c4-lead' ); ?></a>
	</div>
	<?php endwhile; wp_reset_postdata(); ?>
	<?php $sec = new WP_Query( array( 'posts_per_page' => 3, 'post__not_in' => $shown, 'ignore_sticky_posts' => 1, 'no_found_rows' => true ) ); if ( $sec->have_posts() ) : ?>
	<div class="hero__secondary">
		<?php while ( $sec->have_posts() ) : $sec->the_post(); $shown[] = get_the_ID(); $c = c4_primary_cat(); ?>
		<article><span class="kicker"><?php echo $c ? esc_html( $c->name ) : ''; ?></span>
			<h3><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h3>
			<span class="meta"><?php the_author(); ?> · <?php echo esc_html( c4_reading_time() ); ?></span></article>
		<?php endwhile; wp_reset_postdata(); ?>
	</div>
	<?php endif; ?>
</section>

<?php $slugs = array_filter( array_map( 'trim', explode( ',', get_theme_mod( 'c4_rail_cats', 'news,viral,brands,trends' ) ) ) ); if ( $slugs ) : ?>
<section class="rails rule">
	<?php foreach ( $slugs as $slug ) : $cat = get_category_by_slug( $slug ); if ( ! $cat ) continue;
		$q = new WP_Query( array( 'cat' => $cat->term_id, 'posts_per_page' => 3, 'no_found_rows' => true ) ); if ( ! $q->have_posts() ) continue; ?>
	<div class="rail">
		<a class="rail__head" href="<?php echo esc_url( get_category_link( $cat ) ); ?>"><strong><?php echo esc_html( $cat->name ); ?></strong><small><?php esc_html_e( 'ALL →', 'crazy4marketing' ); ?></small></a>
		<?php $i = 0; while ( $q->have_posts() ) : $q->the_post(); c4_rail_item( ++$i ); endwhile; wp_reset_postdata(); ?>
	</div>
	<?php endforeach; ?>
</section>
<?php endif; ?>

<?php $ht = new WP_Query( array( 'category_name' => get_theme_mod( 'c4_hot_take_cat', 'hot-takes' ), 'posts_per_page' => 1, 'no_found_rows' => true ) ); if ( $ht->have_posts() ) : while ( $ht->have_posts() ) : $ht->the_post(); ?>
<section class="hot-take">
	<span class="kicker">— <?php esc_html_e( 'Hot Take', 'crazy4marketing' ); ?> —</span>
	<div class="quote-mark" aria-hidden="true">“</div>
	<h2><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h2>
	<footer><img src="<?php echo esc_url( get_template_directory_uri() . '/assets/symbol_light.png' ); ?>" alt=""><span><?php esc_html_e( 'The Marketing Edit', 'crazy4marketing' ); ?> · <?php the_author(); ?></span></footer>
</section>
<?php endwhile; wp_reset_postdata(); endif; ?>

<section class="latest rule" id="newsletter">
	<div class="two-col">
		<div class="two-col__main">
			<div class="section-title"><span><?php esc_html_e( 'Latest', 'crazy4marketing' ); ?></span><small><?php printf( esc_html__( 'Updated %s', 'crazy4marketing' ), esc_html( wp_date( 'H:i T' ) ) ); ?></small></div>
			<div class="card-grid">
				<?php $lt = new WP_Query( array( 'posts_per_page' => 6, 'post__not_in' => $shown, 'ignore_sticky_posts' => 1, 'no_found_rows' => true ) ); while ( $lt->have_posts() ) : $lt->the_post(); c4_card(); endwhile; wp_reset_postdata(); ?>
			</div>
		</div>
		<aside class="sidebar"><?php c4_trending(); c4_newsletter(); dynamic_sidebar( 'sidebar-1' ); ?></aside>
	</div>
</section>

<?php if ( get_theme_mod( 'c4_show_instagram', true ) ) : $h = get_theme_mod( 'c4_instagram', 'crazy4marketing' ); ?>
<section class="instagram rule">
	<div class="instagram__head"><span><?php esc_html_e( 'On Instagram', 'crazy4marketing' ); ?></span><a href="<?php echo esc_url( 'https://instagram.com/' . $h ); ?>">@<?php echo esc_html( $h ); ?> →</a></div>
	<div class="instagram__grid"><?php foreach ( c4_instagram_tiles() as $src ) : ?><a href="<?php echo esc_url( 'https://instagram.com/' . $h ); ?>"><img src="<?php echo esc_url( $src ); ?>" alt="" loading="lazy"></a><?php endforeach; ?></div>
</section>
<?php endif; ?>
</main>
<?php get_footer();