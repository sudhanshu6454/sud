<?php get_header(); while ( have_posts() ) : the_post(); $c = c4_primary_cat(); $aid = get_the_author_meta( 'ID' ); ?>
<main id="main">
<article <?php post_class( 'single-article' ); ?>>
	<header class="article-head">
		<div class="cats">
			<?php if ( is_sticky() || in_category( 'breaking' ) ) : ?><span class="tag"><?php esc_html_e( 'Breaking', 'crazy4marketing' ); ?></span><?php endif; ?>
			<?php if ( $c ) : ?><a href="<?php echo esc_url( get_category_link( $c ) ); ?>"><?php echo esc_html( $c->name ); ?></a><?php endif; ?>
		</div>
		<h1><?php the_title(); ?></h1>
		<?php if ( has_excerpt() ) : ?><p class="dek"><?php echo esc_html( get_the_excerpt() ); ?></p><?php endif; ?>
		<div class="byline">
			<div class="byline__author">
				<?php $av = get_avatar( $aid, 40 ); echo $av ? $av : '<span class="avatar-box">' . esc_html( c4_author_initials( $aid ) ) . '</span>'; ?>
				<div><strong><?php the_author_posts_link(); ?></strong><span class="meta"><?php echo esc_html( get_the_date() ); ?> · <?php echo esc_html( c4_reading_time() ); ?></span></div>
			</div>
			<div class="byline__share">
				<a class="btn btn--ghost" href="<?php echo esc_url( 'https://twitter.com/intent/tweet?url=' . rawurlencode( get_permalink() ) . '&text=' . rawurlencode( get_the_title() ) ); ?>" target="_blank" rel="noopener"><?php esc_html_e( 'Share', 'crazy4marketing' ); ?></a>
				<button class="btn btn--ghost js-copy" data-url="<?php the_permalink(); ?>"><?php esc_html_e( 'Copy link', 'crazy4marketing' ); ?></button>
			</div>
		</div>
	</header>
	<?php if ( has_post_thumbnail() ) : ?>
	<figure class="article-hero"><div class="thumb thumb--wide"><?php the_post_thumbnail( 'c4-wide' ); ?></div><?php $cap = get_the_post_thumbnail_caption(); if ( $cap ) echo '<figcaption>' . esc_html( $cap ) . '</figcaption>'; ?></figure>
	<?php endif; ?>
	<div class="entry-content"><?php the_content(); wp_link_pages(); ?></div>
	<?php $tags = get_the_tags(); if ( $tags ) : ?><div class="entry-tags"><?php foreach ( $tags as $t ) echo '<a href="' . esc_url( get_tag_link( $t ) ) . '">' . esc_html( $t->name ) . '</a>'; ?></div><?php endif; ?>
	<?php if ( get_the_author_meta( 'description' ) ) : ?>
	<div class="author-box">
		<?php $av = get_avatar( $aid, 56 ); echo $av ? $av : '<span class="avatar-box">' . esc_html( c4_author_initials( $aid ) ) . '</span>'; ?>
		<div><strong><?php the_author(); ?></strong><p><?php the_author_meta( 'description' ); ?></p></div>
	</div>
	<?php endif; ?>
	<?php if ( comments_open() || get_comments_number() ) comments_template(); ?>
</article>
<?php $rel = new WP_Query( array( 'posts_per_page' => 3, 'post__not_in' => array( get_the_ID() ), 'cat' => $c ? $c->term_id : 0, 'no_found_rows' => true ) ); if ( $rel->have_posts() ) : ?>
<section class="related">
	<div class="section-title"><span><?php esc_html_e( 'Related', 'crazy4marketing' ); ?></span></div>
	<div class="card-grid"><?php while ( $rel->have_posts() ) : $rel->the_post(); c4_card(); endwhile; wp_reset_postdata(); ?></div>
</section>
<?php endif; ?>
</main>
<?php endwhile; get_footer();