<?php
/**
 * Static pages (About, Editorial policy, Advertise, Contact…).
 *
 * @package marketing-junkies
 */

get_header();
the_post();
?>
<main id="main" class="mj-page">
	<article <?php post_class(); ?>>
		<h1><?php the_title(); ?></h1>
		<div class="mj-body"><?php the_content(); ?></div>
	</article>
</main>
<?php
get_footer();
