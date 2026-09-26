<?php get_header(); while ( have_posts() ) : the_post(); $c = fb_primary_cat(); $who = get_the_author(); ?>
<main id="main">
<article <?php post_class( 'story' ); ?>>
	<section class="bill bill--story <?php echo has_post_thumbnail() ? '' : 'bill--flat'; ?>"><div class="wrap"><div class="bill__grid">
		<div class="bill__copy">
			<div class="bill__cert">
				<?php if ( is_sticky() ) : ?><span class="cert cert--red"><?php esc_html_e( 'PICK', 'filmybuff' ); ?></span><?php endif; ?>
				<?php if ( $c ) : ?><a class="cert" href="<?php echo esc_url( get_category_link( $c ) ); ?>"><?php echo esc_html( $c->name ); ?></a><?php endif; ?>
			</div>
			<h1><?php the_title(); ?></h1>
			<?php if ( has_excerpt() ) : ?><p class="dek"><?php echo esc_html( get_the_excerpt() ); ?></p><?php endif; ?>
		</div>
		<?php if ( has_post_thumbnail() ) : ?>
		<figure class="bill__still">
			<span class="thumb"><?php the_post_thumbnail( 'fb-wide' ); ?></span>
			<figcaption class="bill__cap"><span><?php echo $c ? esc_html( $c->name ) : esc_html__( 'Story', 'filmybuff' ); ?></span><span><?php echo esc_html( get_the_date( 'd M Y' ) ); ?></span></figcaption>
		</figure>
		<?php endif; ?>
	</div></div></section>
	<div class="stubrow"><div class="wrap">
		<div class="stubrow__meta">
			<span><?php esc_html_e( 'Screening', 'filmybuff' ); ?><b><?php echo esc_html( get_the_date() ); ?></b></span>
			<span><?php esc_html_e( 'Running time', 'filmybuff' ); ?><b><?php echo esc_html( fb_reading_time() ); ?></b></span>
			<?php if ( $who ) : ?><span><?php esc_html_e( 'Reviewer', 'filmybuff' ); ?><b><?php echo esc_html( $who ); ?></b></span><?php endif; ?>
			<?php $cap = get_the_post_thumbnail_caption(); if ( $cap ) : ?><span><?php esc_html_e( 'Still', 'filmybuff' ); ?><b><?php echo esc_html( $cap ); ?></b></span><?php endif; ?>
		</div>
		<div class="stubrow__share">
			<a class="btn btn--ink" href="<?php echo esc_url( 'https://api.whatsapp.com/send?text=' . rawurlencode( get_the_title() . ' ' . get_permalink() ) ); ?>" target="_blank" rel="noopener"><?php esc_html_e( 'WhatsApp', 'filmybuff' ); ?></a>
			<a class="btn btn--ink" href="<?php echo esc_url( 'https://twitter.com/intent/tweet?url=' . rawurlencode( get_permalink() ) . '&text=' . rawurlencode( get_the_title() ) ); ?>" target="_blank" rel="noopener"><?php esc_html_e( 'Share', 'filmybuff' ); ?></a>
			<button class="btn btn--ink js-copy" data-url="<?php the_permalink(); ?>"><?php esc_html_e( 'Copy link', 'filmybuff' ); ?></button>
		</div>
	</div></div>
	<section class="sheet"><div class="wrap"><div class="sheet__col">
		<div class="entry-content"><?php the_content(); wp_link_pages(); ?></div>
		<?php $tags = get_the_tags(); if ( $tags ) : ?><div class="entry-tags"><?php foreach ( $tags as $t ) echo '<a href="' . esc_url( get_tag_link( $t ) ) . '">' . esc_html( $t->name ) . '</a>'; ?></div><?php endif; ?>
		<?php if ( $who ) : ?>
		<div class="credits">
			<span class="cert"><?php echo esc_html( fb_author_initials( get_the_author_meta( 'ID' ) ) ); ?></span>
			<div><strong><?php echo esc_html( $who ); ?></strong><p><?php echo get_the_author_meta( 'description' ) ? esc_html( get_the_author_meta( 'description' ) ) : esc_html__( 'Writes for Filmybuff. Buys tickets.', 'filmybuff' ); ?></p></div>
		</div>
		<?php endif; ?>
	</div>
	<?php if ( comments_open() || get_comments_number() ) comments_template(); ?>
	</div></section>
</article>
<div class="strip" aria-hidden="true"></div>
<?php $rel = new WP_Query( array( 'posts_per_page' => 5, 'post__not_in' => array( get_the_ID() ), 'cat' => $c ? $c->term_id : 0, 'no_found_rows' => true, 'ignore_sticky_posts' => 1 ) ); if ( $rel->have_posts() ) : ?>
<section class="shelf also"><div class="wrap">
	<div class="act"><h2><?php esc_html_e( 'Also showing', 'filmybuff' ); ?></h2><span class="act__line"></span><?php if ( $c ) : ?><a href="<?php echo esc_url( get_category_link( $c ) ); ?>"><?php echo esc_html( $c->name ); ?> →</a><?php endif; ?></div>
	<div class="shelf__track"><?php $i = 0; while ( $rel->have_posts() ) : $rel->the_post(); fb_poster( ++$i ); endwhile; wp_reset_postdata(); ?></div>
</div></section>
<?php endif; ?>
</main>
<?php endwhile; get_footer();
