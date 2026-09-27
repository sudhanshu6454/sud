<?php get_header(); $term = get_queried_object(); ?>
<main id="main">
<section class="wall-head"><div class="wrap">
	<span class="kicker"><a href="<?php echo esc_url( home_url( '/' ) ); ?>"><?php esc_html_e( 'Home', 'filmybuff' ); ?></a> / <?php echo is_category() ? esc_html__( 'Screen', 'filmybuff' ) : esc_html__( 'Archive', 'filmybuff' ); ?></span>
	<div class="row">
		<div><h1><?php echo wp_kses_post( single_term_title( '', false ) ?: get_the_archive_title() ); ?><span>.</span></h1>
		<?php $d = term_description(); if ( $d ) echo '<p class="desc">' . wp_kses_post( wp_strip_all_tags( $d ) ) . '</p>'; ?></div>
		<span class="meta"><?php printf( esc_html( _n( '%s story', '%s stories', $GLOBALS['wp_query']->found_posts, 'filmybuff' ) ), esc_html( number_format_i18n( $GLOBALS['wp_query']->found_posts ) ) ); ?></span>
	</div>
	<?php if ( is_category() ) : ?>
	<nav class="wall-tabs" aria-label="<?php esc_attr_e( 'Screens', 'filmybuff' ); ?>">
		<?php foreach ( get_categories( array( 'orderby' => 'count', 'order' => 'DESC', 'number' => 8 ) ) as $c ) : ?>
		<a href="<?php echo esc_url( get_category_link( $c ) ); ?>" class="<?php echo $term && isset( $term->term_id ) && $term->term_id === $c->term_id ? 'is-active' : ''; ?>"><?php echo esc_html( $c->name ); ?></a>
		<?php endforeach; ?>
	</nav>
	<?php endif; ?>
</div></section>
<section class="wall"><div class="wrap">
	<?php if ( have_posts() ) : ?>
	<div class="wall__grid"><?php $i = 0; while ( have_posts() ) : the_post(); fb_poster( ++$i ); endwhile; ?></div>
	<?php the_posts_pagination( array( 'mid_size' => 2, 'prev_text' => '←', 'next_text' => '→' ) ); else : ?><p class="empty"><?php esc_html_e( 'Nothing on this screen yet.', 'filmybuff' ); ?></p><?php endif; ?>
</div></section>
<?php fb_stubs(); ?>
</main>
<?php get_footer();
